import { describe, expect, it } from "vitest";
import {
  isLocalPosterPath,
  posterFileNameFor,
  resolvePosterAction,
  resolvePosterExtension,
  sanitizeFileId,
  shouldDownload,
  validatePosterBytes
} from "./download-posters.mjs";

describe("sanitizeFileId", () => {
  it("passes a real imdbId through unchanged", () => {
    expect(sanitizeFileId("tt6751668")).toBe("tt6751668");
  });

  it("replaces colons and other unsafe characters in a synthetic id", () => {
    expect(sanitizeFileId("film:grand-bouquet-2019")).toBe("film-grand-bouquet-2019");
  });
});

describe("resolvePosterExtension", () => {
  it("prefers the content-type header", () => {
    expect(resolvePosterExtension("image/png", "https://example.com/x")).toBe(".png");
    expect(resolvePosterExtension("image/webp", "https://example.com/x")).toBe(".webp");
    expect(resolvePosterExtension("image/jpeg", "https://example.com/x")).toBe(".jpg");
  });

  it("falls back to sniffing the URL extension when content-type is missing", () => {
    expect(resolvePosterExtension(null, "https://example.com/poster.png")).toBe(".png");
  });

  it("defaults to .jpg when nothing else matches", () => {
    expect(resolvePosterExtension(null, "https://example.com/poster")).toBe(".jpg");
  });
});

describe("posterFileNameFor", () => {
  it("combines the sanitized id and extension", () => {
    expect(posterFileNameFor("film:the-thing-1982", ".jpg")).toBe("film-the-thing-1982.jpg");
  });
});

describe("isLocalPosterPath", () => {
  it("recognizes a local posters path", () => {
    expect(isLocalPosterPath("/posters/tt1.jpg")).toBe(true);
  });

  it("rejects a remote URL", () => {
    expect(isLocalPosterPath("https://image.tmdb.org/t/p/w500/x.jpg")).toBe(false);
  });

  it("rejects empty/missing values", () => {
    expect(isLocalPosterPath("")).toBe(false);
    expect(isLocalPosterPath(null)).toBe(false);
  });
});

describe("shouldDownload", () => {
  it("skips when there's no posterUrl", () => {
    expect(shouldDownload({ posterUrl: "" }, false)).toBe(false);
  });

  it("skips when posterUrl is already local", () => {
    expect(shouldDownload({ posterUrl: "/posters/tt1.jpg" }, false)).toBe(false);
  });

  it("skips when a local file already exists on disk", () => {
    expect(shouldDownload({ posterUrl: "https://image.tmdb.org/x.jpg" }, true)).toBe(false);
  });

  it("downloads when there's a remote posterUrl and nothing local yet", () => {
    expect(shouldDownload({ posterUrl: "https://image.tmdb.org/x.jpg" }, false)).toBe(true);
  });
});

describe("resolvePosterAction", () => {
  it("reattaches an existing local poster even when posterUrl is empty", () => {
    expect(resolvePosterAction({ posterUrl: "" }, "/posters/tt1.jpg")).toBe("reattach");
  });

  it("reattaches an existing local poster over a stale remote posterUrl", () => {
    expect(resolvePosterAction({ posterUrl: "https://image.tmdb.org/x.jpg" }, "/posters/tt1.jpg")).toBe("reattach");
  });

  it("recognizes a posterUrl that's already a local path", () => {
    expect(resolvePosterAction({ posterUrl: "/posters/tt1.jpg" }, null)).toBe("already-local");
  });

  it("skips when there's no posterUrl and nothing on disk", () => {
    expect(resolvePosterAction({ posterUrl: "" }, null)).toBe("skip-no-poster-url");
  });

  it("downloads when there's a remote posterUrl and nothing local yet", () => {
    expect(resolvePosterAction({ posterUrl: "https://image.tmdb.org/x.jpg" }, null)).toBe("download");
  });
});

describe("validatePosterBytes", () => {
  it("rejects a missing or empty buffer", () => {
    expect(validatePosterBytes(null, "image/jpeg")).toBe(false);
    expect(validatePosterBytes(Buffer.alloc(0), "image/jpeg")).toBe(false);
  });

  it("rejects a trivially small buffer", () => {
    expect(validatePosterBytes(Buffer.alloc(10), "image/jpeg")).toBe(false);
  });

  it("rejects a non-image content-type", () => {
    expect(validatePosterBytes(Buffer.alloc(2000), "text/html")).toBe(false);
  });

  it("accepts a large enough buffer with an image content-type", () => {
    expect(validatePosterBytes(Buffer.alloc(2000), "image/jpeg")).toBe(true);
  });

  it("accepts a large enough buffer when content-type is missing (best-effort)", () => {
    expect(validatePosterBytes(Buffer.alloc(2000), null)).toBe(true);
  });
});
