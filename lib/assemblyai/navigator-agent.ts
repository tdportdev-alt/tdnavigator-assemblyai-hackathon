/**
 * Navigator Voice Agent behaviour, versioned in the repo.
 *
 * The browser configures the session INLINE with NAVIGATOR_SESSION as its first
 * `session.update` (AssemblyAI Voice Agent API: "Inline session configuration") instead of
 * binding the stored agent by `agent_id`. Greeting, voice, keyterms and VAD threshold are
 * copied from the stored agent (session.ready echo 2026-09-25).
 *
 * Turn detection is kept exactly as the stored agent has it (vad 0.5, min_silence 1000,
 * max_silence 3000, barge-in on). Adaptive mode was tried and made mid-sentence pauses worse
 * (see NAVIGATOR_SESSION.input); the split follow-up ("Thanks." … "How far…?") is handled by
 * the server folding / barge-in plus the tool fixes, not by the silence windows.
 */

export const NAVIGATOR_SYSTEM_PROMPT = [
  'You are TDNavigator, the in-cab voice assistant for a truck driver. Reply in one to three short spoken sentences. Lead with the answer. No exclamation marks.',
  '',
  'Tools — call the right one straight away, in the same turn as the question. When in doubt, call the tool:',
  '- Any weather question (temperature, rain, snow, wind, storms, road weather) for a named city or place, for "here", or for "ahead": call get_weather. For a named place pass the place exactly as the driver said it. For the driver\'s own position call it with no arguments. Never ask how many miles ahead to look. If it returns status need_place, ask which town.',
  '  Weather wording: start from the result\'s "say" line. When "current" has a temperature, say it like "It\'s 74 now, forecast high 77." When "current" is null, give the forecast only and never say "currently", "right now" or "it\'s ... now". Then add any alert in one short sentence.',
  '- How far or how long to a place: call get_distance with name = the place as the driver said it (a business, truck stop, landmark, or a town on its own) and near = the town the driver said it is in. Leave `near` empty unless the driver named a town or place. Pass origin only if the driver named a starting place. If it returns status need_origin, ask which town they are starting from (do not call it an outage). If it returns no_position, place_not_found or near_not_found, say that plainly and ask which town.',
  '- Hours of service, drive time or break time left: call get_hos_status and say the driveRemaining clock as hours and minutes (for example "8 hours of drive time left"). Mention the source once (simulated ELD, demo, or duty log).',
  '- Nearest fuel, diesel or fuel prices nearby: call get_fuel_nearby with no arguments and answer from its result in the same reply (nearest station, miles, price when it has one). Never ask the driver for a distance or radius.',
  '- Load number, next turn, ETA, miles left or destination: call get_nav_status and answer from its "say" line. If it says there is no active route, say exactly that; never make up a destination, ETA or load.',
  '- Opening a screen on the dash: call open_screen.',
  '- A book, story or audiobook: call start_audiobook (local reading takes over and Voice Agent billing stops).',
  '',
  'After a tool returns:',
  '- Answer the driver\'s question in that reply from the tool result. Use only the numbers and facts the tool returned: never estimate, re-round or invent values. If the result is marked simulated, say so once.',
  '- If the tool returns an error, is unavailable or times out, say so plainly in one sentence, for example "I can\'t reach the weather service right now, try again in a minute." Never stay silent.',
  '',
  'Questions that need no tool (what you can do, how to use TDNav): answer directly.',
  'Enunciate load and street numbers clearly, digit by digit when they are long.',
].join('\n');

type ToolDef = {
  type: 'function';
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
  execution_mode: 'interactive';
  timeout_seconds: number;
};

export const NAVIGATOR_TOOLS: ToolDef[] = [
  {
    type: 'function',
    name: 'get_weather',
    description:
      'Current forecast and active weather alerts from the US National Weather Service, for a named place or for the driver\'s own position. Call this for ANY weather question: temperature, rain, snow, wind, storms, road weather, a city, here or ahead.',
    parameters: {
      type: 'object',
      properties: {
        place: {
          type: 'string',
          description:
            'The city, town or place exactly as the driver said it, e.g. "Denver" or "Cheyenne, Wyoming". Omit when the driver asks about weather here or ahead.',
          examples: ['Denver', 'Cheyenne, Wyoming', 'Salt Lake City'],
        },
      },
      required: [],
    },
    execution_mode: 'interactive',
    timeout_seconds: 20,
  },
  {
    type: 'function',
    name: 'get_distance',
    description:
      'Truck road distance and drive time to a place, from the truck\'s position or from a starting place the driver names. Call for any "how far" or "how long to" question. ' +
      'Put the place in `name` and the town the driver said it is in, if any, in `near`. Leave `near` empty unless the driver named a town or place. ' +
      'Examples: "the Pilot in North Platte" -> name "Pilot", near "North Platte, NE". "the nearest Pilot" -> name "Pilot", near empty (the server searches around the truck, closest first). ' +
      '"Cheyenne" -> name "Cheyenne", near empty.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'The place itself as the driver said it, without the town: a business, truck stop or landmark ("Pilot", "Love\'s", "the airport"), or the town or city when that is all the driver named ("Cheyenne").',
          examples: ['Pilot', "Love's", 'Cheyenne'],
        },
        near: {
          type: 'string',
          description:
            'Leave `near` empty unless the driver named a town or place. Only the town or city the driver said the place is in or near, with the state when you know it, e.g. "North Platte, NE". Never fill it from the truck\'s position or a guess.',
          examples: ['North Platte, NE', 'Cheyenne, WY'],
        },
        origin: {
          type: 'string',
          description: 'Starting place exactly as the driver said it. Omit unless the driver named one.',
          examples: ['Denver'],
        },
      },
      required: ['name'],
    },
    execution_mode: 'interactive',
    timeout_seconds: 20,
  },
  {
    type: 'function',
    name: 'get_hos_status',
    description: 'Hours-of-service time remaining (drive, break, window, cycle). Call for any question about drive hours or break time left.',
    parameters: {
      type: 'object',
      properties: { detail: { type: 'string', enum: ['drive', 'break', 'summary'] } },
      required: [],
    },
    execution_mode: 'interactive',
    timeout_seconds: 15,
  },
  {
    type: 'function',
    name: 'get_fuel_nearby',
    description:
      'Nearest diesel stations (name, miles away, price when known) around the truck\'s live position. No arguments. Call for any fuel or diesel question, including "where\'s the nearest fuel".',
    parameters: { type: 'object', properties: {}, required: [] },
    execution_mode: 'interactive',
    timeout_seconds: 15,
  },
  {
    type: 'function',
    name: 'get_nav_status',
    description:
      'Active route status from the dash\'s guidance: destination, miles remaining, ETA, next turn, plus the current load if one is booked. Says plainly when there is no active route.',
    parameters: {
      type: 'object',
      properties: { focus: { type: 'string', enum: ['next_turn', 'eta', 'destination', 'summary'] } },
      required: [],
    },
    execution_mode: 'interactive',
    timeout_seconds: 15,
  },
  {
    type: 'function',
    name: 'open_screen',
    description: 'Open a TDNav screen while voice stays on.',
    parameters: {
      type: 'object',
      properties: { screen: { type: 'string', enum: ['map', 'fuel', 'hos', 'truck', 'status', 'road'] } },
      required: ['screen'],
    },
    execution_mode: 'interactive',
    timeout_seconds: 15,
  },
  {
    type: 'function',
    name: 'start_audiobook',
    description:
      'Hand off from the Voice Agent to local Piper audiobook reading. Call when the driver asks to read a book, story or audiobook. This stops Voice Agent billing.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Book or story title' } },
      required: [],
    },
    execution_mode: 'interactive',
    timeout_seconds: 15,
  },
];

/** Copied from the stored agent's session.ready echo (2026-09-25). */
export const NAVIGATOR_GREETING = 'Navigator here. Go ahead.';
export const NAVIGATOR_KEYTERMS = [
  'HOS', 'ELD', 'DVIR', 'weigh station', 'CAT scale', 'diesel', 'reefer', 'hazmat', 'rest area',
  'truck parking', 'ETA', 'I-80', 'I-70', 'I-40', 'bobtail', 'deadhead', 'load', 'drop and hook',
  'shipper', 'receiver', 'load number',
];

/** First (inline) session.update payload — see the header for why it replaces agent_id binding. */
export const NAVIGATOR_SESSION = {
  system_prompt: NAVIGATOR_SYSTEM_PROMPT,
  greeting: NAVIGATOR_GREETING,
  tools: NAVIGATOR_TOOLS,
  input: {
    format: { encoding: 'audio/pcm', sample_rate: 24000 },
    keyterms: NAVIGATOR_KEYTERMS,
    voice_focus: 'near-field',
    // End-of-turn settings are UNCHANGED from the stored agent (explicit so they can't drift).
    // Tested 2026-09-25: fully adaptive (no turn_detection) ended "How far is it…" after 1.0 s,
    // spoke a nav-status answer, and the continuation "from Denver to Cheyenne" was lost to
    // barge-in (several answers, one wrong). With these windows the same pause stays one reply.
    turn_detection: { vad_threshold: 0.5, min_silence: 1000, max_silence: 3000, interrupt_response: true },
  },
  output: {
    voice: 'alba',
    format: { encoding: 'audio/pcm', sample_rate: 24000 },
  },
};
