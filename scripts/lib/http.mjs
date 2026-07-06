export const DEFAULT_SCRAPE_DELAY_MS = 500;

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function fetchWithRetry(url, options, label, maxAttempts = 6) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(url, options);
    if (response.ok) {
      return response;
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt >= maxAttempts) {
      const body = await response.text();
      throw new Error(`${label} failed: ${response.status} ${body.slice(0, 300)}`);
    }

    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 300 * 2 ** attempt;
    await sleep(waitMs);
  }

  throw new Error(`${label} failed after ${maxAttempts} attempts`);
}
