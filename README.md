# TDNavigator — AssemblyAI Voice Agent Hackathon

LabLab AssemblyAI Voice Agent Hackathon 2026 entry for **TDNavigator**: a tablet co-pilot for truck drivers (hands-free voice under motion lock).

**Application / live demo:** https://tdnav.com

## What judges should see

- One **Navigator** hold-to-toggle (top-left) — continuous AssemblyAI Voice Agent listen
- Spoken nav / fuel / HOS answers with clear digit enunciation (demo load & addresses)
- Motion lock: voice works while free typing is blocked on the road
- Cost-aware path: Voice Agent for cab talk; cheap local TTS for long-form story handoff

**Slogan:** Ears and mouth from AssemblyAI. Brains from TDNav.

## License

MIT — see [`LICENSE`](./LICENSE).

This repository is the **thin contest slice** (docs + MIT). The full TDNavigator product remains a separate AGPL codebase and is not mirrored here.

## Secrets

Do not commit API keys. Demo keys live only on the hosted server (`tdnav.com`); the browser receives short-lived tokens only.
