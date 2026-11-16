export const primaryColor = '#101010';

export function canSubmitCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

export async function bootstrap(loadSession, mount) {
  const session = await loadSession();
  return mount({ session, primaryColor });
}
