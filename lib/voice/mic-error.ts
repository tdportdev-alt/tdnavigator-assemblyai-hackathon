// Plain driver copy for microphone (getUserMedia) failures. The raw browser
// error name/message (e.g. "Requested device not found") never reaches the
// screen — it goes to the console only.

export const MIC_ERROR_COPY = {
  notFound: 'No microphone found. Check your headset.',
  blocked: 'Microphone blocked. Allow the mic for this site.',
  busy: 'Microphone is busy in another app.',
  other: "Microphone didn't start. Try again.",
} as const;

/** Map a getUserMedia rejection (DOMException name) to driver copy. */
export function micErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : '';
  switch (name) {
    case 'NotFoundError':
    case 'OverconstrainedError':
      return MIC_ERROR_COPY.notFound;
    case 'NotAllowedError':
    case 'SecurityError':
      return MIC_ERROR_COPY.blocked;
    case 'NotReadableError':
    case 'AbortError':
      return MIC_ERROR_COPY.busy;
    default:
      return MIC_ERROR_COPY.other;
  }
}

/** Log the raw error for debugging; return the driver-facing copy. */
export function reportMicError(err: unknown, where: string): string {
  const e = err as { name?: unknown; message?: unknown } | null;
  console.warn(`[${where}] getUserMedia failed: ${String(e?.name ?? 'Error')}: ${String(e?.message ?? err)}`);
  return micErrorMessage(err);
}

/** Wraps a getUserMedia rejection so a shared catch can tell it apart from token/socket errors. */
export class MicStartError extends Error {
  readonly driverMessage: string;
  constructor(cause: unknown, where: string) {
    const driverMessage = reportMicError(cause, where);
    super(driverMessage);
    this.name = 'MicStartError';
    this.driverMessage = driverMessage;
  }
}

/** getUserMedia that rejects with MicStartError (driver copy) instead of the raw DOMException. */
export async function getMicStream(constraints: MediaStreamConstraints, where: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    throw new MicStartError(e, where);
  }
}
