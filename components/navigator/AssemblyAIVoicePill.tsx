'use client';

// Hands-free headset overlay: tap mic on/off once (browser gesture), then
// continuous AssemblyAI Voice Agent (PCM in, reply.audio out, tool stubs).
// Token from /api/v1/assemblyai/token — API key never reaches the browser.
// data-motion-safe so motion-lock still allows the control while driving.

import { useEffect, useRef, useState } from 'react';
import { runVoiceTool } from '@/lib/assemblyai/tool-runner';
import { MicStartError, getMicStream } from '@/lib/voice/mic-error';

type Ui = 'off' | 'connecting' | 'listening' | 'speaking';

type PendingTool = { call_id: string; name: string; arguments: Record<string, unknown> };

function pcmToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function AssemblyAIVoicePill() {
  const [ui, setUi] = useState<Ui>('off');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [lastTool, setLastTool] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const readyRef = useRef(false);
  const playbackTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const pendingToolsRef = useRef<PendingTool[]>([]);
  const uiRef = useRef<Ui>('off');
  uiRef.current = ui;

  useEffect(() => {
    const onHide = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'session.end' }));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void stopSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flushPlayback() {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
    }
    activeSourcesRef.current = [];
    if (playCtxRef.current) {
      playbackTimeRef.current = playCtxRef.current.currentTime;
    }
  }

  function flushToolResults(ws: WebSocket) {
    const pending = pendingToolsRef.current.splice(0, pendingToolsRef.current.length);
    void (async () => {
    for (const call of pending) {
      const result = await runVoiceTool(call.name, call.arguments || {});
      setLastTool(call.name);
      try {
        ws.send(
          JSON.stringify({
            type: 'tool.result',
            call_id: call.call_id,
            result,
          }),
        );
      } catch {
        /* ignore */
      }
    }
      })();
  }

  async function stopSession() {
    readyRef.current = false;
    flushPlayback();
    pendingToolsRef.current = [];
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'session.end' }));
      }
    } catch {
      /* ignore */
    }
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    workletRef.current?.port.close();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    await captureCtxRef.current?.close().catch(() => undefined);
    captureCtxRef.current = null;
    await playCtxRef.current?.close().catch(() => undefined);
    playCtxRef.current = null;
    setUi('off');
  }

  function playPcm16Base64(b64: string, playCtx: AudioContext) {
    const raw = atob(b64);
    const pcm16 = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm16.length; i++) {
      pcm16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
    const buffer = playCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const src = playCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(playCtx.destination);
    const now = playCtx.currentTime;
    playbackTimeRef.current = Math.max(playbackTimeRef.current, now);
    src.start(playbackTimeRef.current);
    playbackTimeRef.current += buffer.duration;
    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
    };
  }

  async function startSession() {
    setError(null);
    setTranscript('');
    setReply('');
    setLastTool('');
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('Mic needs HTTPS — open https://tdnav.com (plain http blocks the mic).');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('No microphone API in this browser.');
      return;
    }

    setUi('connecting');
    try {
      const tokRes = await fetch('/api/v1/assemblyai/token', { cache: 'no-store' });
      const tokBody = await tokRes.json().catch(() => ({}));
      if (!tokRes.ok || !tokBody.token || !tokBody.agent_id) {
        throw new Error(tokBody?.error || `token failed (${tokRes.status})`);
      }

      const captureCtx = new AudioContext();
      await captureCtx.resume();
      await captureCtx.audioWorklet.addModule('/pcm-processor.js');
      captureCtxRef.current = captureCtx;

      const playCtx = new AudioContext({ sampleRate: 24000 });
      await playCtx.resume();
      playCtxRef.current = playCtx;
      playbackTimeRef.current = playCtx.currentTime;

      const stream = await getMicStream(
        {
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
          },
        },
        'voice-pill',
      );
      streamRef.current = stream;

      const source = captureCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(captureCtx, 'pcm-processor', {
        processorOptions: {
          inputSampleRate: captureCtx.sampleRate,
          targetSampleRate: 24000,
        },
      });
      workletRef.current = worklet;

      const wsUrl = new URL('wss://agents.assemblyai.com/v1/ws');
      wsUrl.searchParams.set('token', tokBody.token);
      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!readyRef.current || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'input.audio', audio: pcmToBase64(e.data) }));
      };
      const mute = captureCtx.createGain();
      mute.gain.value = 0;
      source.connect(worklet).connect(mute).connect(captureCtx.destination);

      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: { agent_id: tokBody.agent_id },
          }),
        );
      });

      ws.addEventListener('message', (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const type = String(msg.type || '');

        if (type === 'session.ready') {
          readyRef.current = true;
          setUi('listening');
          return;
        }
        if (type === 'input.speech.started') {
          // Barge-in: stop agent audio immediately.
          flushPlayback();
          return;
        }
        if (type === 'transcript.user' && typeof msg.text === 'string') {
          setTranscript(msg.text);
          return;
        }
        if (type === 'transcript.user.delta' && typeof msg.text === 'string') {
          setTranscript(msg.text);
          return;
        }
        if (type === 'tool.call') {
          pendingToolsRef.current.push({
            call_id: String(msg.call_id || ''),
            name: String(msg.name || ''),
            arguments: (msg.arguments as Record<string, unknown>) || {},
          });
          return;
        }
        if (type === 'reply.started') {
          setUi('speaking');
          return;
        }
        if (type === 'reply.audio' && typeof msg.data === 'string' && playCtxRef.current) {
          playPcm16Base64(msg.data, playCtxRef.current);
          return;
        }
        if (type === 'transcript.agent' && typeof msg.text === 'string') {
          setReply(msg.text);
          return;
        }
        if (type === 'reply.done') {
          if (msg.status === 'interrupted') flushPlayback();
          // Docs: send tool.result after reply.done (not during reply.started).
          flushToolResults(ws);
          if (uiRef.current !== 'off') setUi('listening');
          return;
        }
        if (type === 'session.ended') {
          void stopSession();
          return;
        }
        if (type === 'session.error' || type === 'error') {
          setError(String(msg.message || msg.code || 'Voice Agent error'));
          void stopSession();
        }
      });

      ws.addEventListener('close', () => {
        if (uiRef.current !== 'off') void stopSession();
      });
      ws.addEventListener('error', () => {
        setError('Voice Agent connection failed');
        void stopSession();
      });
    } catch (e) {
      if (e instanceof MicStartError) {
        setError(e.driverMessage);
      } else {
        const err = e as Error;
        console.warn('[voice-pill] voice start failed', err);
        setError(err.message || 'Could not start voice');
      }
      await stopSession();
    }
  }

  async function toggle() {
    if (uiRef.current === 'off') await startSession();
    else await stopSession();
  }

  const label =
    ui === 'off'
      ? 'Mic off — tap to listen'
      : ui === 'connecting'
        ? 'Connecting…'
        : ui === 'speaking'
          ? 'Navigator speaking…'
          : 'Listening — hands-free';

  return (
    <div
      data-motion-safe="true"
      data-assemblyai-voice-pill="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex flex-col items-center gap-2 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {(transcript || reply || lastTool || error) && (
        <div className="pointer-events-auto max-w-xl rounded-2xl border border-nav-border bg-nav-card/95 px-4 py-3 text-center shadow-lg backdrop-blur-sm">
          {error && <div className="text-sm text-red-300">{error}</div>}
          {lastTool && (
            <div className="mb-1 text-[10px] uppercase tracking-widest text-nav-muted">
              Tool {lastTool}
            </div>
          )}
          {transcript && (
            <div className="text-xs uppercase tracking-widest text-nav-muted">You</div>
          )}
          {transcript && <div className="text-base text-nav-text">{transcript}</div>}
          {reply && (
            <div className="mt-2 text-xs uppercase tracking-widest text-nav-amber">Navigator</div>
          )}
          {reply && <div className="text-lg font-medium text-nav-amber">{reply}</div>}
        </div>
      )}

      <button
        type="button"
        data-motion-safe="true"
        aria-pressed={ui !== 'off'}
        aria-label={label}
        onClick={() => void toggle()}
        disabled={ui === 'connecting'}
        className={`pointer-events-auto relative flex h-16 min-w-[16rem] select-none items-center justify-center gap-3 rounded-full border-2 px-8 text-lg font-semibold shadow-2xl backdrop-blur-sm active:brightness-90 disabled:opacity-80 ${
          ui === 'listening' || ui === 'speaking'
            ? 'border-red-500 bg-red-600 text-white'
            : ui === 'connecting'
              ? 'border-nav-amber bg-nav-card/95 text-nav-amber'
              : 'border-nav-amber bg-nav-card/95 text-nav-amber'
        }`}
      >
        {(ui === 'listening' || ui === 'speaking') && (
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />
        )}
        <span className="relative z-10">{label}</span>
      </button>
    </div>
  );
}
