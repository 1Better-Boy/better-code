globalThis.__reviewEncoderInitializations =
  (globalThis.__reviewEncoderInitializations ?? 0) + 1;

export function initEncoder() {
  return { ready: true };
}
