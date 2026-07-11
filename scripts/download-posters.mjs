import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchWithRetry } from "./lib/http.mjs";

const root = process.cwd();
const filmsPath = path.join(root, "data", "normalized", "films.json");
const postersDir = path.join(root, "public", "posters");

const POSTER_EXTENSIONS = [".jpg", ".png", ".webp"];
const BATCH_SIZE = 10;

// Film ids are either a real imdbId ("tt6751668", already filesystem-safe)
// or a synthetic "film:{slug}-{year}" id (build-comprehensive-data.mjs's
// resolveFilmId fallback) — the colon isn't a valid filename character on
// Windows, so it (and anything else non-alphanumeric) gets replaced.
export function sanitizeFileId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function resolvePosterExtension(contentType, url) {
  const type = String(contentType ?? "").toLowerCase();
  if (type.includes("png")) {
    return ".png";
  }
  if (type.includes("webp")) {
    return ".webp";
  }
  if (type.includes("jpeg") || type.includes("jpg")) {
    return ".jpg";
  }
  const match = /\.(jpe?g|png|webp)(?:$|\?)/i.exec(String(url ?? ""));
  if (match) {
    const ext = match[1].toLowerCase();
    return ext === "jpeg" ? ".jpg" : `.${ext}`;
  }
  return ".jpg";
}

export function posterFileNameFor(filmId, extension) {
  return `${sanitizeFileId(filmId)}${extension}`;
}

export function isLocalPosterPath(url) {
  return typeof url === "string" && url.startsWith("/posters/");
}

export function shouldDownload(film, alreadyExistsLocally) {
  if (!film.posterUrl) {
    return false;
  }
  if (isLocalPosterPath(film.posterUrl)) {
    return false;
  }
  if (alreadyExistsLocally) {
    return false;
  }
  return true;
}

export function validatePosterBytes(buffer, contentType) {
  if (!buffer || buffer.byteLength < 1000) {
    return false;
  }
  const type = contentType ? String(contentType).toLowerCase() : "";
  if (type && !type.startsWith("image/")) {
    return false;
  }
  return true;
}

// Checks disk for an already-downloaded poster regardless of what
// film.posterUrl currently says — necessary because data:build regenerates
// films.json (with remote URLs) from source on every run, so this script
// must be able to re-derive the local path for an already-downloaded film
// without re-downloading it.
function findExistingLocalPoster(filmId) {
  for (const extension of POSTER_EXTENSIONS) {
    const fileName = posterFileNameFor(filmId, extension);
    if (existsSync(path.join(postersDir, fileName))) {
      return `/posters/${fileName}`;
    }
  }
  return null;
}

async function downloadPoster(film) {
  const response = await fetchWithRetry(film.posterUrl, {}, `poster ${film.id}`);
  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!validatePosterBytes(buffer, contentType)) {
    throw new Error(`Invalid poster response (content-type=${contentType}, bytes=${buffer.byteLength})`);
  }

  const fileName = posterFileNameFor(film.id, resolvePosterExtension(contentType, film.posterUrl));
  await writeFile(path.join(postersDir, fileName), buffer);
  return `/posters/${fileName}`;
}

async function run() {
  await mkdir(postersDir, { recursive: true });
  const films = JSON.parse(await readFile(filmsPath, "utf8"));

  const stats = { total: films.length, alreadyLocal: 0, downloaded: 0, skippedNoPosterUrl: 0, failed: 0 };
  const failures = [];

  for (let index = 0; index < films.length; index += BATCH_SIZE) {
    const batch = films.slice(index, index + BATCH_SIZE);

    await Promise.all(
      batch.map(async (film) => {
        if (!film.posterUrl) {
          stats.skippedNoPosterUrl += 1;
          return;
        }
        if (isLocalPosterPath(film.posterUrl)) {
          stats.alreadyLocal += 1;
          return;
        }

        const existingLocalPath = findExistingLocalPoster(film.id);
        if (!shouldDownload(film, Boolean(existingLocalPath))) {
          film.posterUrl = existingLocalPath;
          stats.alreadyLocal += 1;
          return;
        }

        try {
          film.posterUrl = await downloadPoster(film);
          stats.downloaded += 1;
        } catch (error) {
          stats.failed += 1;
          failures.push({
            id: film.id,
            imdbId: film.imdbId,
            url: film.posterUrl,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      })
    );

    // Persist after every batch so a late failure only risks the current
    // batch's progress, mirroring enrich-tmdb.mjs's incremental persistence.
    await writeFile(filmsPath, `${JSON.stringify(films, null, 2)}\n`, "utf8");
  }

  console.log(
    `Poster download complete. total=${stats.total}, alreadyLocal=${stats.alreadyLocal}, downloaded=${stats.downloaded}, skippedNoPosterUrl=${stats.skippedNoPosterUrl}, failed=${stats.failed}`
  );
  if (failures.length) {
    console.log(`Failures (${failures.length}):`, JSON.stringify(failures.slice(0, 20), null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Poster download failed", error);
    process.exitCode = 1;
  });
}
