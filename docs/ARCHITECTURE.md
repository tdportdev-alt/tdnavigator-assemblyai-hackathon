# Architecture

## Session lifecycle

1. Driver holds the Navigator button. The browser asks for the microphone first.
2. Browser calls `GET /api/v1/assemblyai/token`. The server checks the origin and the caps in
   `lib/voice/token-guard.ts`, then asks AssemblyAI for a single-use token (`expires_in_seconds`,
   `max_session_duration_seconds`) using the server-side key.
3. Browser opens `wss://agents.assemblyai.com/v1/ws?token=…` and sends `session.update` with the inline
   configuration from `lib/assemblyai/navigator-agent.ts` (prompt, tools, keyterms, turn detection).
4. On `session.ready` the client streams `input.audio` (base64 PCM16, 24 kHz) and plays `reply.audio`.
5. On `input.speech.started` the client stops playback immediately (barge-in).
6. On `tool.call` the client queues the call and, after `reply.done`, runs it with
   `lib/assemblyai/tool-runner.ts` and sends `tool.result`.
7. Turning voice off, closing the page (`pagehide`) or hitting the session limit sends `session.end`.

## Tools

| Tool | Route it calls | Answers |
|------|----------------|---------|
| `get_weather` | `GET /api/v1/road/weather?place=` | National Weather Service forecast and alerts for a named place, or at the truck's position when no place is given |
| `get_distance` | `GET /api/v1/nav/distance?to=&near=&from=` | Truck road miles and drive time; `near` narrows a business name to a town; no origin means the truck's live position |
| `get_hos_status` | `GET /api/v1/hos/status` | Drive, break, window and cycle time left, marked simulated when it is |
| `get_fuel_nearby` | `GET /api/v1/fuel/nearby` | Nearest diesel stations (name, miles, price when known); the first three are read out |
| `get_nav_status` | `GET /api/v1/nav/status` | Destination, ETA, miles left and next turn, or an explicit "no active route" |
| `open_screen` | none (client side) | Opens a screen on the dash while voice stays on |
| `start_audiobook` | none (client side) | Ends the billed Voice Agent session and hands off to local text to speech |

Every route returns JSON. A body with an `error` field, a non-2xx status, a timeout (8 s for most tools,
18 s for distance) or a network failure becomes one `{ error, message }` result, which the agent says out loud.

## Token guard (public demo)

Enabled with `TDNAV_PUBLIC_DEMO_GUARD=1`. Order of checks: origin (or referer) allow-list, per-IP window,
server-wide hourly cap, server-wide daily cap. A slot is reserved when a request is allowed and released if the
token mint fails. Only the rightmost `X-Forwarded-For` entry is trusted because that is the one the reverse proxy
sets. Every issued token and every refusal is logged as one JSON line without the token.
