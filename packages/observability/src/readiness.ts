/**
 * Probe an HTTP URL for readiness. Returns `true` if `fetch` resolves with
 * a 2xx status before `timeoutMs`; `false` on any error, timeout, or
 * non-2xx response. Used by services to surface upstream dependencies in
 * their `/health` response.
 */
export async function pingHttpUrl(url: string, timeoutMs = 1_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
