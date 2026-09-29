import { NextRequest, NextResponse } from 'next/server';
import { checkTokenRequest, guardConfig, logTokenEvent } from '@/lib/voice/token-guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/assemblyai/token — mint a single-use Voice Agent browser token.
 * Key stays server-side. agent_id is returned so the browser can bind the session
 * without embedding secrets in the client bundle.
 *
 * One token = one talk session (TALK ON until TALK OFF / session end); questions inside the
 * session reuse the open socket. On the public demo the route is guarded (origin allow-list,
 * per-IP and server-wide caps, short token + session life): see lib/voice/token-guard.ts for the
 * TDNAV_PUBLIC_DEMO_GUARD switch. With the switch unset the behaviour is unchanged.
 */
export async function GET(req: NextRequest) {
  const key = process.env.ASSEMBLYAI_API_KEY?.trim();
  const agentId = process.env.ASSEMBLYAI_AGENT_ID?.trim();
  if (!key) {
    return NextResponse.json(
      { error: 'ASSEMBLYAI_API_KEY not configured' },
      { status: 503 },
    );
  }
  if (!agentId) {
    return NextResponse.json(
      { error: 'ASSEMBLYAI_AGENT_ID not configured' },
      { status: 503 },
    );
  }

  const cfg = guardConfig();
  let release: (() => void) | null = null;
  let ip = '';
  let origin: string | null = null;
  if (cfg.enabled) {
    const d = checkTokenRequest(req.headers, cfg);
    ip = d.ip;
    origin = d.origin;
    if (!d.ok) {
      await logTokenEvent(cfg, { event: 'refused', status: d.status, reason: d.reason, cap: d.cap ?? null, ip: d.ip, origin: d.origin });
      const headers: Record<string, string> = {};
      if (d.retryAfterS) headers['Retry-After'] = String(Math.max(1, d.retryAfterS));
      return NextResponse.json(
        { error: d.reason, cap: d.cap ?? null, message: d.message, retry_after_s: d.retryAfterS ?? null },
        { status: d.status, headers },
      );
    }
    release = d.release;
  }

  const expiresIn = cfg.enabled ? cfg.tokenTtlS : 300;
  const maxSession = cfg.enabled ? cfg.maxSessionS : 3600;
  const url = new URL('https://agents.assemblyai.com/v1/token');
  url.searchParams.set('expires_in_seconds', String(expiresIn));
  url.searchParams.set('max_session_duration_seconds', String(maxSession));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
  } catch (e) {
    release?.();
    if (cfg.enabled) await logTokenEvent(cfg, { event: 'mint_failed', status: 502, ip, origin, detail: (e as Error).message });
    return NextResponse.json({ error: 'AssemblyAI token request failed' }, { status: 502 });
  }

  if (!response.ok) {
    release?.();
    const detail = await response.text().catch(() => '');
    if (cfg.enabled) await logTokenEvent(cfg, { event: 'mint_failed', status: response.status, ip, origin });
    return NextResponse.json(
      { error: `AssemblyAI token failed (${response.status})`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    release?.();
    return NextResponse.json({ error: 'AssemblyAI returned no token' }, { status: 502 });
  }
  if (cfg.enabled) {
    await logTokenEvent(cfg, { event: 'issued', ip, origin, expires_in_seconds: expiresIn, max_session_seconds: maxSession });
  }
  return NextResponse.json({
    token: body.token,
    agent_id: agentId,
    provider: 'assemblyai-voice-agent',
    max_session_seconds: maxSession,
  });
}
