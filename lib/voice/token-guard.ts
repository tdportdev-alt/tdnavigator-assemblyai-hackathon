// Public-demo guard for GET /api/v1/assemblyai/token.
//
// The token route mints paid AssemblyAI Voice Agent sessions. On the public demo (tdnav.com) it
// must not be an open faucet; on an installed tablet (driver's own key) nothing changes.
//
// SWITCH (all values come from the service environment; set them for the tdnav service with a
// systemd drop-in, e.g. /etc/systemd/system/tdnav.service.d/public-demo.conf — never in .env):
//   TDNAV_PUBLIC_DEMO_GUARD=1                 turn the guard on. Unset/anything else: behaviour
//                                             is exactly as before (no checks, old token params).
//   TDNAV_DEMO_ALLOWED_ORIGINS=https://tdnav.com,https://www.tdnav.com
//                                             Origin (or, when the browser sends no Origin, the
//                                             Referer's origin) must be one of these. A request
//                                             with neither header is refused (403).
//   TDNAV_DEMO_TOKENS_PER_IP=6                sessions per client IP per window
//   TDNAV_DEMO_IP_WINDOW_S=600                ...window length (10 min)
//   TDNAV_DEMO_TOKENS_PER_HOUR=30             server-wide sessions per rolling hour
//   TDNAV_DEMO_TOKENS_PER_DAY=100             server-wide sessions per rolling 24 h
//   TDNAV_DEMO_MAX_SESSION_S=600              max_session_duration_seconds (API range 60-10800)
//   TDNAV_DEMO_TOKEN_TTL_S=15                 expires_in_seconds = redemption window (API range
//                                             1-600). The browser asks for the mic FIRST and only
//                                             then fetches the token, so the window only has to
//                                             cover audio setup + socket open.
//   TDNAV_DEMO_TOKEN_LOG=<path>               JSON-lines log; default $TDNAV_DATA_DIR/voice-token-log.jsonl
//
// Client IP: the reverse proxy (nginx) appends $remote_addr to X-Forwarded-For. Only that LAST
// entry is set by the proxy; earlier entries and any client-sent X-Real-IP can be forged, so the
// guard trusts only the rightmost X-Forwarded-For value.
//
// Counters are in memory (single `next start` process): they reset when the service restarts.
// Every issued token and every refusal (with its reason and which cap) is logged with IP, time and
// origin — never the token.

import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export type GuardConfig = {
  enabled: boolean;
  allowedOrigins: string[];
  perIp: number;
  ipWindowMs: number;
  perHour: number;
  perDay: number;
  maxSessionS: number;
  tokenTtlS: number;
  logPath: string;
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(process.env[name] ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function guardConfig(): GuardConfig {
  const dataDir = process.env.TDNAV_DATA_DIR || path.join(process.cwd(), 'data');
  return {
    enabled: String(process.env.TDNAV_PUBLIC_DEMO_GUARD || '').trim() === '1',
    allowedOrigins: String(process.env.TDNAV_DEMO_ALLOWED_ORIGINS || 'https://tdnav.com')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
      .filter(Boolean),
    perIp: intEnv('TDNAV_DEMO_TOKENS_PER_IP', 6, 1, 1000),
    ipWindowMs: intEnv('TDNAV_DEMO_IP_WINDOW_S', 600, 10, 86400) * 1000,
    perHour: intEnv('TDNAV_DEMO_TOKENS_PER_HOUR', 30, 1, 100000),
    perDay: intEnv('TDNAV_DEMO_TOKENS_PER_DAY', 100, 1, 1000000),
    maxSessionS: intEnv('TDNAV_DEMO_MAX_SESSION_S', 600, 60, 10800),
    tokenTtlS: intEnv('TDNAV_DEMO_TOKEN_TTL_S', 15, 1, 600),
    logPath: process.env.TDNAV_DEMO_TOKEN_LOG || path.join(dataDir, 'voice-token-log.jsonl'),
  };
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const byIp = new Map<string, number[]>();
let issuedAll: number[] = [];

function prune(list: number[], windowMs: number, now: number): number[] {
  let i = 0;
  while (i < list.length && now - list[i] >= windowMs) i++;
  return i ? list.slice(i) : list;
}

export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1].slice(0, 64);
  }
  return 'direct';
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export type GuardDecision =
  | { ok: true; ip: string; origin: string; release: () => void }
  | { ok: false; status: 403 | 429; reason: string; cap?: string; message: string; retryAfterS?: number; ip: string; origin: string | null };

/** Origin gate + per-IP / hourly / daily caps. Reserves a slot when it allows the request. */
export function checkTokenRequest(headers: Headers, cfg: GuardConfig, now = Date.now()): GuardDecision {
  const ip = clientIp(headers);
  const origin = originOf(headers.get('origin'));
  const refOrigin = originOf(headers.get('referer'));
  const seen = origin ?? refOrigin;
  if (!seen) {
    return { ok: false, status: 403, reason: 'missing_origin', message: 'Forbidden.', ip, origin: null };
  }
  if (!cfg.allowedOrigins.includes(seen)) {
    return { ok: false, status: 403, reason: 'foreign_origin', message: 'Forbidden.', ip, origin: seen };
  }

  const mine = prune(byIp.get(ip) ?? [], cfg.ipWindowMs, now);
  byIp.set(ip, mine);
  issuedAll = prune(issuedAll, DAY_MS, now);
  const lastHour = issuedAll.filter((t) => now - t < HOUR_MS);

  if (mine.length >= cfg.perIp) {
    const retry = Math.ceil((cfg.ipWindowMs - (now - mine[0])) / 1000);
    return { ok: false, status: 429, reason: 'voice_busy', cap: 'per_ip', message: 'Too many voice sessions from this device. Try again in a few minutes.', retryAfterS: retry, ip, origin: seen };
  }
  if (lastHour.length >= cfg.perHour) {
    const retry = Math.ceil((HOUR_MS - (now - lastHour[0])) / 1000);
    return { ok: false, status: 429, reason: 'voice_busy', cap: 'hourly', message: 'Voice is busy right now. Try again later.', retryAfterS: retry, ip, origin: seen };
  }
  if (issuedAll.length >= cfg.perDay) {
    const retry = Math.ceil((DAY_MS - (now - issuedAll[0])) / 1000);
    return { ok: false, status: 429, reason: 'voice_busy', cap: 'daily', message: 'Voice is busy today. Try again later.', retryAfterS: retry, ip, origin: seen };
  }

  mine.push(now);
  issuedAll.push(now);
  // Pruning keeps the map small; drop IPs whose window is empty.
  if (byIp.size > 5000) for (const [k, v] of byIp) if (!v.length || now - v[v.length - 1] >= cfg.ipWindowMs) byIp.delete(k);
  const release = () => {
    const a = byIp.get(ip);
    if (a) {
      const i = a.lastIndexOf(now);
      if (i >= 0) a.splice(i, 1);
    }
    const g = issuedAll.lastIndexOf(now);
    if (g >= 0) issuedAll.splice(g, 1);
  };
  return { ok: true, ip, origin: seen, release };
}

/** One JSON line per issued token / refusal (never the token). Also mirrored to the journal. */
export async function logTokenEvent(cfg: GuardConfig, entry: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
  console.info(`[voice-token] ${line}`);
  try {
    await mkdir(path.dirname(cfg.logPath), { recursive: true });
    await appendFile(cfg.logPath, line + '\n');
  } catch (e) {
    console.warn('[voice-token] log write failed', (e as Error).message);
  }
}
