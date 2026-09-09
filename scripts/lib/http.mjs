export const DEFAULT_SCRAPE_DELAY_MS = 500;
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// A hung SPARQL/TMDB/Wikipedia request previously had no way to time out —
// this pipeline runs unattended in CI, where a stalled fetch would block the
// job indefinitely instead of failing fast and letting the retry loop (or
// the caller's optional-step handling) take over. Only applied when the
// caller hasn't already supplied its own AbortSignal.
export async function fetchWithRetry(url, options, label, maxAttempts = 6, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const fetchOptions = options?.signal ? options : { ...options, signal: AbortSignal.timeout(timeoutMs) };

    let response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (error) {
      // fetch() itself can throw (a transient connection drop, DNS hiccup,
      // or our own AbortSignal timeout firing) — this is exactly the class
      // of failure retries exist for, but it bypasses the ok/status check
      // below entirely, so it needs its own retry path. Confirmed live: a
      // large Wikidata SPARQL query (Oscars ceremony, ~90k-row LIMIT) failed
      // with a bare "terminated" network error, and without this it wasn't
      // retried at all, silently costing the largest single Wikidata source.
      if (attempt >= maxAttempts) {
        throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sleep(300 * 2 ** attempt);
      continue;
    }

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
