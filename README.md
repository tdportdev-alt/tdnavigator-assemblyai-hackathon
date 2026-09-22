# TDNavigator — AssemblyAI Voice Agent Hackathon

Tablet co-pilot for truck drivers. Hands-free voice under motion lock, built on the **AssemblyAI Voice Agent API**.

**Live demo (judges):** https://tdnav.com  
Start GPS + OBDLink under **System → Simulation** (`https://tdnav.com/system/simulation`). Subtle **Simulated** pills appear only while those streams run — not a live fleet feed.

**Slogan:** Ears and mouth from AssemblyAI. Brains from TDNav.

## Why this exists

Drivers already juggle maps, ELD/HOS, fuel, weather, and load details on a fixed-mount tablet. Typing while moving is unsafe and illegal in spirit under FMCSA distraction rules. TDNavigator is the partner that rides along: talk clear, know the load number and address, flip the screen when asked — like KITT for the truck.

## Architecture (contest)

| Layer | Role | Stack |
|-------|------|--------|
| **Ears + mouth + humanizer** | Listen, turn-taking, speak natural answers | AssemblyAI **Voice Agent API** (STT + managed LLM + TTS + tools) |
| **Brains / engine** | Facts: load, HOS, fuel, nav, preferences | TDNav app engine (tools return JSON; live fuel via exchange along sim GPS) |

AssemblyAI does **not** invent truck truth. The Voice Agent calls tools, gets engine facts, then humanizes them for the driver.

**Cost-aware path:** Voice Agent (~cab talk only) while the Navigator toggle is on. Toggle off → `session.end` → meter stops. Long-form “read my book” hands off to cheap local TTS (Piper/Kokoro) — not Voice Agent $/hr.

## What judges should click (≤2 min)

1. Open **https://tdnav.com/system/simulation** (or cockpit **System → Simulation**).
2. **GPS → Start** a corridor (e.g. I-80 west of Lincoln) — loops until Stop.
3. **OBDLink → Start** (Cascadia/DD13 DEMO) — confirm AT init log (ATZ → … → Mode 01).
4. Return to the map/cockpit: subtle **GPS · Simulated** / **OBD · Simulated** pills only while those streams run.
5. Confirm **one** orange **Navigator** hold-toggle at **top-left**.
6. **Hold ~1 second** → **VOICE AGENT · LIVE**, then ask:
   - “What’s my load number?” → **14598**
   - “Confirm delivery address.” → **148 NE** / **1864 N**
   - Optional: HOS remaining / **cheapest diesel nearby** (live exchange along the GPS fix)
7. **Barge-in** once mid-reply.
8. Optional: “Read my book” → toggle **off** → meter stops → cheap TTS.

## Demo URL

| Item | Value |
|------|--------|
| Application URL | https://tdnav.com |
| Simulation (GPS + OBDLink) | https://tdnav.com/system/simulation |
| Health | `GET https://tdnav.com/api/v1/health` |
| GPS share (public) | https://tdnav.com/gps-share |

`/demo` redirects to Simulation. No LAN / raw VPS IP in the public demo surface. Simulation is labeled and never pretends to be production telematics.

## Team notes (not required for judges)

- Full TDNavigator product is a separate **AGPL** tree (not mirrored here).
- This GitHub repo is the **thin contest slice**: docs + MIT only, so judges can review framing without the private product dump.
- API keys stay on the host. The browser only receives **short-lived** Voice Agent tokens.

## License

**MIT** — see [`LICENSE`](./LICENSE).

Submissions for this hackathon must be original, open source, and MIT-compliant per LabLab participation terms.

## Secrets

Do **not** commit AssemblyAI, OpenRouter, or host API keys. Demo secrets live only on `tdnav.com`.
