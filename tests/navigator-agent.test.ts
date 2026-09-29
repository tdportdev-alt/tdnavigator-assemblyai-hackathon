import { describe, expect, it } from 'vitest';
import { NAVIGATOR_KEYTERMS, NAVIGATOR_SESSION, NAVIGATOR_SYSTEM_PROMPT, NAVIGATOR_TOOLS } from '@/lib/assemblyai/navigator-agent';

describe('Navigator session config', () => {
  it('every tool the prompt tells the agent to call is defined', () => {
    const named = [...NAVIGATOR_SYSTEM_PROMPT.matchAll(/\b(get_[a-z_]+|open_screen|start_audiobook)\b/g)].map((m) => m[1]);
    const defined = new Set(NAVIGATOR_TOOLS.map((t) => t.name));
    for (const n of new Set(named)) expect(defined.has(n), n).toBe(true);
  });

  it('required parameters exist and tools answer within the driver-friendly timeout', () => {
    for (const t of NAVIGATOR_TOOLS) {
      for (const req of t.parameters.required) expect(Object.keys(t.parameters.properties), `${t.name}.${req}`).toContain(req);
      expect(t.timeout_seconds).toBeLessThanOrEqual(20);
      expect(t.execution_mode).toBe('interactive');
    }
  });

  it('keeps barge-in on and the 24 kHz PCM format both ways', () => {
    expect(NAVIGATOR_SESSION.input.turn_detection.interrupt_response).toBe(true);
    expect(NAVIGATOR_SESSION.input.format.sample_rate).toBe(24000);
    expect(NAVIGATOR_SESSION.output.format.sample_rate).toBe(24000);
  });

  it('never tells the agent to make up values', () => {
    expect(NAVIGATOR_SYSTEM_PROMPT).toMatch(/never estimate/i);
    expect(NAVIGATOR_SYSTEM_PROMPT).toMatch(/never make up a destination, ETA or load/i);
  });

  it('keyterms contain no street addresses', () => {
    for (const k of NAVIGATOR_KEYTERMS) expect(/^\d{3,}\b/.test(k), k).toBe(false);
  });
});
