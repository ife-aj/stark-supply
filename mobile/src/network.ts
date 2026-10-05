// React Native's AbortSignal polyfill does not provide AbortSignal.timeout().
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  milliseconds = 15000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("The connection timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
