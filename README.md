# TDNavigator — AssemblyAI Voice Agent Hackathon

Tablet co-pilot for truck drivers. Hands-free voice under motion lock, built on the **AssemblyAI Voice Agent API**.

**Live demo (judges):** https://tdnav.com

**Slogan:** Ears and mouth from AssemblyAI. Brains from TDNav.

## Why this exists

Drivers already juggle maps, ELD/HOS, fuel, weather, and load details on a fixed-mount tablet. Typing while moving is unsafe and illegal in spirit under FMCSA distraction rules. TDNavigator is the partner that rides along: talk clear, know the load number and address, flip the screen when asked — like KITT for the truck.

## Architecture (contest)

| Layer | Role | Stack |
|-------|------|--------|
| **Ears + mouth + humanizer** | Listen, turn-taking, speak natural answers | AssemblyAI **Voice Agent API** (STT + managed LLM + TTS + tools) |
| **Brains / engine** | Facts: load, HOS, fuel, nav, preferences | TDNav app engine (tools return JSON; stubs OK for demo) |

AssemblyAI does **not** invent truck truth. The Voice Agent calls tools, gets engine facts, then humanizes them for the driver.

**Cost-aware path:** Voice Agent (~cab talk only) while the Navigator toggle is on. Toggle off → `session.end` → meter stops. Long-form “read my book” hands off to cheap local TTS (Piper/Kokoro) — not Voice Agent $/hr.

## What judges should click (≤2 min)

1. Open **https://tdnav.com** (landscape / tablet viewport if you can).
2. Confirm **one** orange **Navigator** hold-toggle at **top-left** (outer frame only).
3. **Hold ~1 second** → glow / Connecting → **VOICE AGENT · LIVE** (+ on-screen $/hr meter).
4. Ask (headset or mic):
   - “What’s my load number?” → clear digits (e.g. **14598**)
   - “Confirm delivery address.” → smooth street enunciation (e.g. **148 NE** / **1864 N**)
   - Optional: HOS remaining / cheapest diesel nearby
5. **Barge-in** once mid-reply (interrupt) to show turn-taking.
6. Optional: “Read my book” → toggle **off** → meter stops → cheap TTS path (not Voice Agent burn).
7. Motion lock: with `?motionLock=1` (or while “moving”), free text is blocked; voice still works.

## Demo URL

| Item | Value |
|------|--------|
| Application URL | https://tdnav.com |
| Health | `GET https://tdnav.com/api/v1/health` |
| GPS share (public) | https://tdnav.com/gps-share |

No LAN / raw VPS IP in the public demo surface.

## Team notes (not required for judges)

- Full TDNavigator product is a separate **AGPL** tree (not mirrored here).
- This GitHub repo is the **thin contest slice**: docs + MIT only, so judges can review framing without the private product dump.
- API keys stay on the host. The browser only receives **short-lived** Voice Agent tokens.

## License

**MIT** — see [`LICENSE`](./LICENSE).

Submissions for this hackathon must be original, open source, and MIT-compliant per LabLab participation terms.

## Secrets

Do **not** commit AssemblyAI, OpenRouter, or host API keys. Demo secrets live only on `tdnav.com`.
