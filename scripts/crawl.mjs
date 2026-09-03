// Crawls the public jhu.semester.ly API into one catalog snapshot.
// No auth needed. Polite: serial requests with a delay.
import { writeFileSync } from "node:fs";

const BASE = "https://jhu.semester.ly";
const SEM = process.env.SEM ?? "Fall";
const YEAR = process.env.YEAR ?? "2026";
const OUT = process.env.OUT ?? "catalog.json";
const DELAY_MS = 250;
const PAGE_LIMIT = 100; // server caps advanced search at 100 matches

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(filters, page) {
  const url = `${BASE}/search/${SEM}/${YEAR}/?limit=${PAGE_LIMIT}&page=${page}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ filters }),
  });
  if (!res.ok) throw new Error(`${res.status} ${url} ${await res.text()}`);
  return (await res.json()).data ?? [];
}

// Pull every page for one filter. Returns rows plus whether we hit the
// server's 100-match ceiling (meaning results were silently truncated).
async function pull(filters) {
  const rows = [];
  for (let page = 1; ; page++) {
    const batch = await post(filters, page);
    rows.push(...batch);
    await sleep(DELAY_MS);
    if (batch.length < PAGE_LIMIT) break;
  }
  return { rows, truncated: rows.length >= PAGE_LIMIT };
}

const school = await (await fetch(`${BASE}/school/jhu`)).json();
// The department list carries two naming shapes: 57 "AS "/"EN "-prefixed
// entries that are a near-empty legacy shape, and 440 unprefixed ones that
// hold the real courses. Crawl all of them and select Homewood by course
// code below -- filtering on the prefixed names silently returns junk.
const departments = school.departments;
const LEVELS = school.levels;

console.log(`${departments.length} departments, ${SEM} ${YEAR}`);

const byId = new Map();
let truncatedDepts = 0;

for (const [i, dept] of departments.entries()) {
  const base = { departments: [dept], areas: [], levels: [], times: [] };
  let { rows, truncated } = await pull(base);

  // Hit the ceiling -> re-crawl this department partitioned by course level
  // so nothing is silently dropped.
  if (truncated) {
    truncatedDepts++;
    rows = [];
    for (const lvl of LEVELS) {
      const r = await pull({ ...base, levels: [lvl] });
      rows.push(...r.rows);
    }
  }

  for (const c of rows) byId.set(c.id, c);
  console.log(
    `[${i + 1}/${departments.length}] ${dept}: ${rows.length}` +
      (truncated ? " (split by level)" : "") +
      ` | total ${byId.size}`,
  );
}

// Homewood undergrad lives under the AS./EN. code prefixes. Everything else
// (PH, ME, BU, SA, ED) is a different campus and not schedulable alongside it.
const homewood = [...byId.values()].filter((c) => /^(AS|EN)\./.test(c.code));

const catalog = {
  semester: { name: SEM, year: YEAR },
  crawled_at: new Date().toISOString(),
  source: `${BASE} (public API)`,
  last_updated: school.last_updated,
  areas: school.areas,
  departments,
  courses: homewood,
};
console.log(`\n${byId.size} crawled -> ${homewood.length} Homewood (AS./EN.)`);

writeFileSync(OUT, JSON.stringify(catalog));
console.log(
  `\nwrote ${OUT}: ${catalog.courses.length} courses, ${truncatedDepts} departments needed level-splitting`,
);
