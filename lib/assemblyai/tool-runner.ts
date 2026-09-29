/** Voice Agent function tools: the browser-side runner that answers the agent's tool.call events. */

export type ToolCallArgs = Record<string, unknown>;

const SCREEN_MAP: Record<string, { route: string; label: string }> = {
  map: { route: '/map', label: 'Map' },
  navigation: { route: '/map', label: 'Map' },
  fuel: { route: '/fuel', label: 'Fuel' },
  diesel: { route: '/fuel', label: 'Fuel' },
  hos: { route: '/hos', label: 'HOS' },
  hours: { route: '/hos', label: 'HOS' },
  truck: { route: '/truck', label: 'Truck' },
  status: { route: '/status', label: 'Status' },
  weather: { route: '/road', label: 'Road' },
  road: { route: '/road', label: 'Road' },
  demo: { route: '/demo', label: 'Simulated routes' },
};

export function resolveOpenScreen(args: ToolCallArgs): { route: string; label: string } | null {
  const raw = String(args.screen || args.route || args.target || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('/')) {
    return { route: raw, label: raw.replace(/^\//, '') || 'Screen' };
  }
  for (const [key, val] of Object.entries(SCREEN_MAP)) {
    if (raw === key || raw.includes(key)) return val;
  }
  return null;
}

/**
 * Sync tools that need no data (open_screen, start_audiobook). Every data tool (weather,
 * distance, HOS, fuel, nav status) is answered by runVoiceTool from a live server route —
 * the position they use is the server's own lib/gps/current fix, never a browser cache.
 */
export function runVoiceToolStub(name: string, args: ToolCallArgs = {}): string {
  switch (name) {
    case 'open_screen': {
      const hit = resolveOpenScreen(args);
      if (!hit) {
        return JSON.stringify({ ok: false, error: 'unknown_screen', args });
      }
      return JSON.stringify({ ok: true, ...hit });
    }
    case 'start_audiobook': {
      const title = String(args.title || 'your book');
      return JSON.stringify({
        ok: true,
        action: 'handoff_to_piper',
        title,
        billing: 'stop_voice_agent',
        note: 'End Voice Agent session, then local Piper reads. Cost meter stops.',
      });
    }
    default:
      return JSON.stringify({ error: `unknown_tool:${name}`, args });
  }
}

/**
 * Where the tool routes live. The browser uses same-origin relative URLs (default). Out-of-browser
 * callers (QA harnesses driving real sessions) pass an absolute base such as https://tdnav.com.
 */
export type VoiceToolOptions = { baseUrl?: string };

function toolUrl(opts: VoiceToolOptions | undefined, pathAndQuery: string): string {
  const base = (opts?.baseUrl || '').replace(/\/+$/, '');
  return `${base}${pathAndQuery}`;
}

const DATA_TOOL_TIMEOUT_MS = 8_000;

/** GET a tool route and hand its JSON to the agent; failures become one plain `error` result. */
async function getJson(
  opts: VoiceToolOptions | undefined,
  pathAndQuery: string,
  what: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; result: string }> {
  try {
    const res = await fetch(toolUrl(opts, pathAndQuery), {
      cache: 'no-store',
      signal: AbortSignal.timeout(DATA_TOOL_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || body.error) {
      return {
        ok: false,
        result: JSON.stringify({
          error: String(body?.error || `${what}_http_${res.status}`),
          message: String(body?.message || `The ${what} lookup did not answer.`),
        }),
      };
    }
    return { ok: true, body };
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      ok: false,
      result: JSON.stringify({
        error: timedOut ? `${what}_timeout` : `${what}_fetch_failed`,
        message: timedOut ? `The ${what} lookup timed out.` : `The ${what} lookup failed.`,
      }),
    };
  }
}

const hours = (ms: unknown) => (typeof ms === 'number' && Number.isFinite(ms) ? Math.round((ms / 3_600_000) * 100) / 100 : null);
const clock = (ms: unknown) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const m = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

/** Hours of service from /api/v1/hos/status — the exact snapshot the dash's Drive tile shows. */
async function runHosTool(args: ToolCallArgs, opts?: VoiceToolOptions): Promise<string> {
  const detail = String(args.detail || 'summary');
  const r = await getJson(opts, '/api/v1/hos/status', 'hours');
  if (!r.ok) return r.result;
  const body = r.body;
  const snap = body.snapshot as { status?: string; remaining?: Record<string, number> } | undefined;
  const rem = snap?.remaining;
  if (!rem) return JSON.stringify({ error: 'hos_unavailable', message: 'Hours of service are not available right now.' });
  const eld = body.eldRunning === true;
  const demo = body.demo === true;
  const source = eld ? 'eld-sim' : demo ? 'demo' : 'duty-log';
  return JSON.stringify({
    source,
    detail,
    dutyStatus: snap?.status ?? null,
    driveRemaining: clock(rem.driveMs),
    driveRemainingHours: hours(rem.driveMs),
    untilBreak: clock(rem.untilBreakMs),
    windowRemainingHours: hours(rem.windowMs),
    cycleRemainingHours: hours(rem.cycleMs),
    simulated: eld || demo,
    note: eld
      ? 'Simulated ELD (EldSim) — not a certified ELD reading. Same clock as the Drive tile.'
      : demo
        ? 'Demo clock — not a certified ELD reading. Same clock as the Drive tile.'
        : "From the driver's own duty log, not a certified ELD. Same clock as the Drive tile.",
  });
}

/** Nearest diesel from /api/v1/fuel/nearby at the server's live position (no numbers asked of the driver). */
async function runFuelTool(opts?: VoiceToolOptions): Promise<string> {
  const r = await getJson(opts, '/api/v1/fuel/nearby', 'fuel');
  if (!r.ok) return r.result;
  const stations = Array.isArray(r.body.stations) ? (r.body.stations as Record<string, unknown>[]) : [];
  return JSON.stringify({
    source: r.body.source ?? 'fuel-pois',
    position: r.body.position ?? null,
    online: r.body.online ?? null,
    count: stations.length,
    stations: stations.slice(0, 3).map((st) => ({
      name: st.name,
      brand: st.brand ?? null,
      miles: st.distanceMi,
      diesel_usd: st.priceUsd ?? null,
      price_as_of: st.priceAsOf ?? null,
    })),
    ...(stations.length === 0 ? { note: 'No fuel stations found within 50 miles of the live position.' } : {}),
  });
}

/** Route / ETA / next turn / load from /api/v1/nav/status (real guidance state only). */
async function runNavStatusTool(args: ToolCallArgs, opts?: VoiceToolOptions): Promise<string> {
  const r = await getJson(opts, '/api/v1/nav/status', 'navigation');
  if (!r.ok) return r.result;
  const body = r.body;
  // The ETA is an instant; say it in the driver's own time zone (this runs in their browser).
  const etaAt = typeof body.eta_at === 'string' ? new Date(body.eta_at) : null;
  const etaLocal = etaAt && !Number.isNaN(etaAt.getTime())
    ? etaAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;
  const say = typeof body.say === 'string' ? body.say.replace('{eta}', etaLocal ?? 'an unknown time') : null;
  return JSON.stringify({ focus: String(args.focus || 'summary'), ...body, eta_local: etaLocal, say });
}

/** Async tool runner — every data tool reads a live server route. */
export async function runVoiceTool(
  name: string,
  args: ToolCallArgs = {},
  opts?: VoiceToolOptions,
): Promise<string> {
  switch (name) {
    case 'get_hos_status':
      return runHosTool(args, opts);
    case 'get_weather':
      return runWeatherTool(args, opts);
    case 'get_distance':
      return runDistanceTool(args, opts);
    case 'get_fuel_nearby':
      return runFuelTool(opts);
    case 'get_nav_status':
    case 'get_load':
    case 'get_load_status':
      return runNavStatusTool(args, opts);
    default:
      return runVoiceToolStub(name, args);
  }
}

const WEATHER_TOOL_TIMEOUT_MS = 8_000;

/** Live NWS weather for a spoken place name (geocoded server-side) or the current position. */
async function runWeatherTool(args: ToolCallArgs, opts?: VoiceToolOptions): Promise<string> {
  const params = new URLSearchParams();
  const place = typeof args.place === 'string' ? args.place.trim() : '';
  // "Here / ahead": no position is sent — the server uses its own live fix (lib/gps/current).
  if (place) params.set('place', place);
  try {
    const res = await fetch(toolUrl(opts, `/api/v1/road/weather?${params.toString()}`), {
      cache: 'no-store',
      signal: AbortSignal.timeout(WEATHER_TOOL_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || body.error) {
      return JSON.stringify({
        error: String(body?.error || `weather_http_${res.status}`),
        message: String(body?.message || 'Weather service did not answer.'),
        requested: body?.requested ?? { place: place || null },
      });
    }
    return JSON.stringify(body);
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return JSON.stringify({
      error: timedOut ? 'weather_timeout' : 'weather_fetch_failed',
      message: timedOut ? 'Weather lookup timed out.' : 'Weather lookup failed.',
      requested: { place: place || null },
    });
  }
}

/** True when a tool result JSON carries an `error` field (sent to the agent as is_error). */
export function toolResultIsError(result: string): boolean {
  try {
    const j = JSON.parse(result) as Record<string, unknown>;
    return Boolean(j && typeof j === 'object' && j.error);
  } catch {
    return false;
  }
}

const DISTANCE_TOOL_TIMEOUT_MS = 18_000;

/** Plain console line per distance lookup (no secrets): what the model sent and what the server picked. */
function logDistance(name: string, near: string, body: Record<string, unknown> | null, error?: string) {
  const r = (body?.resolved ?? null) as Record<string, unknown> | null;
  const c = (r?.center ?? null) as Record<string, unknown> | null;
  const p = (r?.picked ?? null) as Record<string, unknown> | null;
  const parts = [`[navigator] get_distance name=${JSON.stringify(name)} near=${JSON.stringify(near)}`];
  if (r) parts.push(`mode=${String(r.mode)}`);
  if (c) parts.push(c.kind === 'gps' ? `gps=${c.lat},${c.lon} fix_t=${c.fix_t ?? 'n/a'}` : `near_point=${c.lat},${c.lon}`);
  if (p) parts.push(`picked=${JSON.stringify(p.name)} picked_at=${p.lat},${p.lon} picked_mi=${r?.picked_mi ?? 'n/a'}`);
  if (r) parts.push(`candidates=${r.candidates} runner_up_mi=${r.runner_up_mi ?? 'none'}`);
  if (body && typeof body.road_miles === 'number') parts.push(`road_miles=${body.road_miles}`);
  if (error) parts.push(`error=${error}`);
  console.info(parts.join(' '));
}

/**
 * Truck road distance + drive time to a spoken place (optionally from a spoken place).
 * Args: `name` (business, landmark or town) + optional `near` (the town the driver said it is in).
 * An older session's `destination` string is still accepted as `name`.
 */
async function runDistanceTool(args: ToolCallArgs, opts?: VoiceToolOptions): Promise<string> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const to = str(args.name) || str(args.destination);
  const near = str(args.near);
  const from = str(args.origin);
  const params = new URLSearchParams();
  if (to) params.set('to', to);
  if (to && near) params.set('near', near);
  // No origin spoken → the server starts at the live position it sees itself (lib/gps/current);
  // the browser never sends a cached position as the origin.
  if (from) params.set('from', from);
  try {
    const res = await fetch(toolUrl(opts, `/api/v1/nav/distance?${params.toString()}`), {
      cache: 'no-store',
      signal: AbortSignal.timeout(DISTANCE_TOOL_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || body.error) {
      const error = String(body?.error || `distance_http_${res.status}`);
      logDistance(to, near, body, error);
      return JSON.stringify({
        error,
        message: String(body?.message || 'Distance lookup did not answer.'),
        requested: body?.requested ?? { from: from || null, to, near: near || null },
      });
    }
    logDistance(to, near, body);
    // The lookup trail (centre, candidates, runner-up) is for the log, not for the model to read out.
    const { resolved: _resolved, ...forModel } = body;
    return JSON.stringify(forModel);
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const error = timedOut ? 'distance_timeout' : 'distance_fetch_failed';
    logDistance(to, near, null, error);
    return JSON.stringify({
      error,
      message: timedOut ? 'Distance lookup timed out.' : 'Distance lookup failed.',
      requested: { from: from || null, to, near: near || null },
    });
  }
}
