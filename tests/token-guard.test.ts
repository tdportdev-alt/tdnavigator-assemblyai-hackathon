import { beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('@/lib/voice/token-guard');
}

const h = (o: Record<string, string>) => new Headers(o);
const ok = { origin: 'https://tdnav.com', 'x-forwarded-for': '203.0.113.7' };

describe('token guard', () => {
  beforeEach(() => {
    delete process.env.TDNAV_PUBLIC_DEMO_GUARD;
    delete process.env.TDNAV_DEMO_TOKENS_PER_IP;
    delete process.env.TDNAV_DEMO_TOKENS_PER_HOUR;
  });

  it('is off unless TDNAV_PUBLIC_DEMO_GUARD=1', async () => {
    const g = await load();
    expect(g.guardConfig().enabled).toBe(false);
    process.env.TDNAV_PUBLIC_DEMO_GUARD = '1';
    expect(g.guardConfig().enabled).toBe(true);
  });

  it('refuses requests with no Origin or Referer', async () => {
    const g = await load();
    const d = g.checkTokenRequest(h({ 'x-forwarded-for': '203.0.113.7' }), g.guardConfig());
    expect(d.ok).toBe(false);
    if (!d.ok) expect([d.status, d.reason]).toEqual([403, 'missing_origin']);
  });

  it('refuses a foreign origin and accepts the allowed one (Referer works when Origin is absent)', async () => {
    const g = await load();
    const cfg = g.guardConfig();
    const bad = g.checkTokenRequest(h({ origin: 'https://evil.example', 'x-forwarded-for': '203.0.113.8' }), cfg);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('foreign_origin');
    const viaReferer = g.checkTokenRequest(h({ referer: 'https://tdnav.com/map', 'x-forwarded-for': '203.0.113.9' }), cfg);
    expect(viaReferer.ok).toBe(true);
  });

  it('trusts only the rightmost X-Forwarded-For entry', async () => {
    const g = await load();
    expect(g.clientIp(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.50' }))).toBe('203.0.113.50');
    expect(g.clientIp(h({}))).toBe('direct');
  });

  it('caps sessions per IP and reports Retry-After', async () => {
    process.env.TDNAV_DEMO_TOKENS_PER_IP = '3';
    const g = await load();
    const cfg = g.guardConfig();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(g.checkTokenRequest(h(ok), cfg, t0 + i).ok).toBe(true);
    const fourth = g.checkTokenRequest(h(ok), cfg, t0 + 10);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect([fourth.status, fourth.cap]).toEqual([429, 'per_ip']);
      expect(fourth.retryAfterS).toBeGreaterThan(0);
    }
    // another driver is unaffected
    expect(g.checkTokenRequest(h({ ...ok, 'x-forwarded-for': '198.51.100.4' }), cfg, t0 + 11).ok).toBe(true);
    // the window rolls over
    expect(g.checkTokenRequest(h(ok), cfg, t0 + cfg.ipWindowMs + 100).ok).toBe(true);
  });

  it('applies the server-wide hourly cap across IPs', async () => {
    process.env.TDNAV_DEMO_TOKENS_PER_HOUR = '2';
    const g = await load();
    const cfg = g.guardConfig();
    const t0 = 5_000_000;
    expect(g.checkTokenRequest(h({ ...ok, 'x-forwarded-for': '10.0.0.1' }), cfg, t0).ok).toBe(true);
    expect(g.checkTokenRequest(h({ ...ok, 'x-forwarded-for': '10.0.0.2' }), cfg, t0 + 1).ok).toBe(true);
    const third = g.checkTokenRequest(h({ ...ok, 'x-forwarded-for': '10.0.0.3' }), cfg, t0 + 2);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.cap).toBe('hourly');
  });

  it('release() gives the slot back when the mint fails', async () => {
    process.env.TDNAV_DEMO_TOKENS_PER_IP = '1';
    const g = await load();
    const cfg = g.guardConfig();
    const first = g.checkTokenRequest(h(ok), cfg, 9_000_000);
    expect(first.ok).toBe(true);
    if (first.ok) first.release();
    expect(g.checkTokenRequest(h(ok), cfg, 9_000_001).ok).toBe(true);
  });
});
