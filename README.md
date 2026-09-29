# TDNavigator — a hands-free voice co-pilot for truck drivers

Built for the **LabLab AssemblyAI Voice Agent Hackathon 2026** on the **AssemblyAI Voice Agent API**.

**Live demo:** https://tdnav.com (built for a landscape tablet, 1024–1280 px wide)

A truck driver cannot type, tap through menus or read a paragraph while moving. TDNavigator is a tablet
app where the driver just talks: weather ahead, how far to the next Pilot, how many drive hours are left,
where the cheapest diesel is. The Navigator answers in one to three short spoken sentences, from real data,
and says so plainly when it does not have an answer.

> Ears and mouth from AssemblyAI. Facts from the truck.

## Try it in two minutes

1. Open https://tdnav.com on a laptop or tablet (voice needs HTTPS and a microphone; a headset works best).
2. Optional but recommended: open **System → Simulation** and start the **GPS** corridor so the Navigator has a position.
3. **Hold the orange Navigator button for one second.** Allow the microphone. It says "Navigator here. Go ahead."
4. Ask, for example:
   - "What's the weather in Denver?" / "What's the weather ahead?"
   - "How far is Cheyenne?" / "How far is the nearest Pilot?" / "How far is the Pilot in North Platte?"
   - "How many drive hours do I have left?"
   - "Where's the nearest diesel?"
   - "What's my ETA?" (with no route set it says there is no active route, it never makes one up)
   - "Open the fuel screen."
5. Interrupt it mid-answer. It stops talking right away (barge-in).
6. Hold the button again to turn voice off. The session ends and the meter stops.

## What is in this repository

This is the voice layer of the app, extracted from the full TDNavigator source (which is a separate AGPL project).
It is the part that talks to AssemblyAI, and it has tests.

| Path | What it does |
|------|--------------|
| `lib/assemblyai/navigator-agent.ts` | The Navigator's system prompt, its 7 function tools with JSON schemas, keyterms, turn detection and audio format. Sent inline as the first `session.update`. |
| `app/api/v1/assemblyai/token/route.ts` | Server route that mints a **single-use browser token**. The AssemblyAI key never reaches the browser. |
| `lib/voice/token-guard.ts` | Keeps the public demo from becoming a paid-voice faucet: origin allow-list, per-IP, hourly and daily caps, short token life and session length, JSON-lines audit log. |
| `components/navigator/AssemblyAIVoicePill.tsx` | The browser client: mic capture to 24 kHz PCM, WebSocket to `wss://agents.assemblyai.com/v1/ws`, streamed playback, barge-in, and tool-call handling. |
| `public/pcm-processor.js` | AudioWorklet that resamples microphone audio to 24 kHz PCM16. |
| `lib/assemblyai/tool-runner.ts` | Runs the agent's tool calls against the app's live routes and turns every failure into one plain, speakable error. |
| `lib/voice/mic-error.ts` | Plain-language microphone errors for a driver ("Check your headset."), never raw browser messages. |
| `tests/` | 20 unit tests for the token guard, tool runner and agent configuration. |

The tool routes themselves (`/api/v1/road/weather`, `/api/v1/nav/distance`, `/api/v1/hos/status`,
`/api/v1/fuel/nearby`, `/api/v1/nav/status`) live in the full app. Their contract is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## How a question flows

```
Driver speaks ──▶ AudioWorklet (24 kHz PCM16) ──▶ AssemblyAI Voice Agent (speech to text + LLM + text to speech)
                                                        │  tool.call  (e.g. get_distance {name:"Pilot", near:"North Platte, NE"})
                                                        ▼
                                          Browser tool runner ──▶ TDNav server routes (routing, NWS weather, fuel, HOS)
                                                        │  tool.result (JSON, or one plain error)
                                                        ▼
Driver hears the answer ◀── streamed reply.audio ◀── AssemblyAI humanizes the facts it was given
```

AssemblyAI does not invent truck facts. The agent is told to answer only from tool results, never to
estimate or re-round, to say "simulated" once when data is simulated, and to say "no active route" when there is none.

## Design choices that matter in a cab

- **Motion-safe by design.** Voice is a toggle, not a push-to-talk chain of taps. The control stays usable under the app's motion lock.
- **Never silent, never made up.** Timeouts and outages become a spoken sentence such as "I can't reach the weather service right now, try again in a minute."
- **Turn detection tuned for drivers.** Longer silence windows keep "How far is it… from Denver to Cheyenne" as one question. Barge-in is on.
- **Cost is bounded.** One token is one talk session; toggling off ends the session; the public demo has per-IP and server-wide caps; long-form reading hands off to local text to speech instead of billed Voice Agent minutes.
- **Not an ELD.** Hours-of-service answers say they come from a simulated or duty-log clock, not a certified ELD.

## Run the tests

```bash
pnpm install
pnpm test        # 20 tests
pnpm typecheck
```

To use the token route in your own Next.js app, copy the files above, keep the same paths, and set the
variables in [`.env.example`](.env.example). The guard is off unless `TDNAV_PUBLIC_DEMO_GUARD=1`.

## License

MIT, see [LICENSE](LICENSE). No API keys are in this repository.
