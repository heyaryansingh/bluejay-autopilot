import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCatalog } from "./catalog";
import type { Catalog, Course } from "./types";

let cache: { courses: Course[]; meta: Omit<Catalog, "courses"> } | null = null;

/** Reads the crawled snapshot once per process. */
export function getCatalog() {
  if (cache) return cache;
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "data", "catalog.json"), "utf8"),
  ) as Catalog;
  const { courses: _drop, ...meta } = raw;
  cache = { courses: normalizeCatalog(raw), meta };
  return cache;
}

/** Called by the refresh route after a re-crawl writes a new snapshot. */
export function invalidate() {
  cache = null;
}
