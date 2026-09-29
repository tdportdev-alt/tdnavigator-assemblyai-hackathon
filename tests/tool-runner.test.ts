import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOpenScreen, runVoiceTool, runVoiceToolStub, toolResultIsError } from '@/lib/assemblyai/tool-runner';

const HOUR = 3_600_000;

function mockFetch(handler: (url: string) => { status?: number; body: unknown } | Error) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = handler(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('open_screen / start_audiobook', () => {
  it('maps spoken screen names to routes', () => {
    expect(resolveOpenScreen({ screen: 'fuel' })?.route).toBe('/fuel');
    expect(resolveOpenScreen({ screen: 'show me diesel' })?.route).toBe('/fuel');
    expect(resolveOpenScreen({ screen: '/hos' })?.route).toBe('/hos');
    expect(resolveOpenScreen({ screen: 'nonsense' })).toBeNull();
  });

  it('rejects unknown screens instead of guessing', () => {
    const r = JSON.parse(runVoiceToolStub('open_screen', { screen: 'nonsense' }));
    expect(r.ok).toBe(false);
  });

  it('hands audiobooks off to local reading and stops voice billing', () => {
    const r = JSON.parse(runVoiceToolStub('start_audiobook', { title: 'Moby Dick' }));
    expect(r).toMatchObject({ ok: true, action: 'handoff_to_piper', billing: 'stop_voice_agent', title: 'Moby Dick' });
  });
});

describe('data tools', () => {
  it('reports drive time left as a clock, flagged simulated in demo mode', async () => {
    mockFetch(() => ({ body: { demo: true, snapshot: { status: 'driving', remaining: { driveMs: 8 * HOUR, untilBreakMs: 5.5 * HOUR, windowMs: 12 * HOUR, cycleMs: 60 * HOUR } } } }));
    const r = JSON.parse(await runVoiceTool('get_hos_status', { detail: 'drive' }));
    expect(r).toMatchObject({ driveRemaining: '8:00', untilBreak: '5:30', simulated: true, source: 'demo' });
    expect(r.note).toMatch(/not a certified ELD/i);
  });

  it('sends the spoken place and the town separately, and hides the lookup trail from the model', async () => {
    const calls = mockFetch(() => ({ body: { road_miles: 41.2, resolved: { mode: 'near', candidates: 3 } } }));
    const r = JSON.parse(await runVoiceTool('get_distance', { name: 'Pilot', near: 'North Platte, NE' }));
    const u = new URL(calls[0], 'http://x');
    expect(u.pathname).toBe('/api/v1/nav/distance');
    expect([u.searchParams.get('to'), u.searchParams.get('near')]).toEqual(['Pilot', 'North Platte, NE']);
    expect(r.road_miles).toBe(41.2);
    expect(r.resolved).toBeUndefined();
  });

  it('returns at most three fuel stations', async () => {
    mockFetch(() => ({ body: { stations: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, distanceMi: i + 1 })) } }));
    const r = JSON.parse(await runVoiceTool('get_fuel_nearby'));
    expect(r.count).toBe(6);
    expect(r.stations).toHaveLength(3);
  });

  it('turns a network failure into one plain error the agent can say out loud', async () => {
    mockFetch(() => new Error('boom'));
    const raw = await runVoiceTool('get_weather', { place: 'Denver' });
    expect(toolResultIsError(raw)).toBe(true);
    expect(JSON.parse(raw).message).toMatch(/failed|timed out|did not answer/i);
  });

  it('never invents a route: unknown tools return an error', async () => {
    const raw = await runVoiceTool('teleport', {});
    expect(toolResultIsError(raw)).toBe(true);
  });
});
