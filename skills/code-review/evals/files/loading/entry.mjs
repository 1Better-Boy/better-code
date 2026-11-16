import { primaryColor } from './barrel.mjs';

export function initialScreen() {
  return { background: primaryColor };
}

export async function openExport() {
  const { initEncoder } = await import('./encoder.mjs');
  return initEncoder();
}

export async function parsePixels(values, visit) {
  for (const value of values) visit(value);
}
