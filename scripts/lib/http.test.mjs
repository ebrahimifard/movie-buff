import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./http.mjs";

function makeResponse(status, { retryAfter, body = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "retry-after" && retryAfter !== undefined ? String(retryAfter) : null) },
    text: async () => body,
    json: async () => JSON.parse(body || "{}")
  };
}

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the response immediately on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.com", {}, "test");
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse(429)).mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://example.com", {}, "test");
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await promise;

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse(503)).mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://example.com", {}, "test");
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await promise;

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts and throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(500, { body: "server error" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://example.com", {}, "test", 3);
    const expectation = expect(promise).rejects.toThrow(/test failed/);
    await vi.advanceTimersByTimeAsync(60_000);
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries when fetch() itself throws (a network error, not an HTTP error response), then succeeds", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("terminated")).mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://example.com", {}, "test");
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await promise;

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts when fetch() keeps throwing, and includes the underlying error message", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("terminated"));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://example.com", {}, "test", 3);
    const expectation = expect(promise).rejects.toThrow(/test failed: terminated/);
    await vi.advanceTimersByTimeAsync(60_000);
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(404, { body: "not found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithRetry("https://example.com", {}, "test")).rejects.toThrow(/test failed: 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attaches an AbortSignal timeout when the caller doesn't provide one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithRetry("https://example.com", {}, "test");

    const [, calledOptions] = fetchMock.mock.calls[0];
    expect(calledOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves a caller-provided AbortSignal instead of overriding it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchWithRetry("https://example.com", { signal: controller.signal }, "test");

    const [, calledOptions] = fetchMock.mock.calls[0];
    expect(calledOptions.signal).toBe(controller.signal);
  });

  it("honors the Retry-After header instead of exponential backoff", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse(429, { retryAfter: 2 })).mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://example.com", {}, "test");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_500);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
