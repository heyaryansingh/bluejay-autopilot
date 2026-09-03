import type { Constraints, Course, Meeting, Pick, Schedule, Section } from "./types";

/** Two meeting blocks collide when they share a day and their times overlap. */
export function conflicts(a: Meeting, b: Meeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

export function sectionConflicts(a: Section, b: Section): boolean {
  return a.meetings.some((m) => b.meetings.some((n) => conflicts(m, n)));
}

/** Does this section satisfy the time-of-day / free-day constraints? */
function sectionAllowed(s: Section, c: Constraints): boolean {
  if (c.avoidFull && s.full) return false;
  return s.meetings.every((m) => {
    if (c.freeDays?.includes(m.day)) return false;
    if (c.earliestStart !== undefined && m.start < c.earliestStart) return false;
    if (c.latestEnd !== undefined && m.end > c.latestEnd) return false;
    return true;
  });
}

function matchesKeywords(course: Course, keywords: string[]): boolean {
  const hay = `${course.name} ${course.description} ${course.department}`.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

/** Hard filters. A course that fails any of these can never appear. */
export function eligible(course: Course, c: Constraints): Course | null {
  if (c.excludeCourses?.some((x) => course.code.startsWith(x))) return null;
  if (c.minLevel !== undefined && course.level < c.minLevel) return null;
  if (c.maxLevel !== undefined && course.level > c.maxLevel) return null;
  if (c.writingIntensive && !course.writingIntensive) return null;
  if (c.departments?.length && !c.departments.some((d) =>
    course.department.toLowerCase().includes(d.toLowerCase()))) return null;
  // Unrated courses are not penalised by a rating floor -- most of the catalog
  // has never been evaluated, and excluding it would gut the search space.
  if (c.minRating !== undefined && course.rating !== null && course.rating < c.minRating)
    return null;

  const sections = course.sections.filter((s) => sectionAllowed(s, c));
  if (sections.length === 0) return null;
  return { ...course, sections };
}

/** Reaction counts turned into a -1..1 sentiment. */
export function vibe(course: Course): number {
  const good = (course.reactions.FIRE ?? 0) + (course.reactions.LOVE ?? 0) +
    (course.reactions.INTERESTING ?? 0);
  const bad = (course.reactions.CRAP ?? 0) + (course.reactions.BORING ?? 0);
  const total = good + bad;
  return total === 0 ? 0 : (good - bad) / total;
}

/** How much we want this course, independent of the rest of the schedule. */
export function courseScore(course: Course, c: Constraints): number {
  let score = 0;
  // Ratings are the strongest signal we have, and the one the user asked for.
  if (course.rating !== null) score += (course.rating - 3.5) * 12;
  score += vibe(course) * 8;
  if (c.requiredCourses?.some((r) => course.code.startsWith(r))) score += 500;
  if (c.requiredAreas?.some((a) => course.areas.includes(a))) score += 25;
  if (c.keywords?.length && matchesKeywords(course, c.keywords)) score += 30;
  // Nudge away from sections that are already jammed.
  const openest = Math.max(...course.sections.map((s) => s.size - s.enrolment));
  if (openest <= 0) score -= 15;
  // 1-credit seminars are cheap ways to hit a credit target and make for
  // absurd 8-course schedules. Allowed, but never preferred.
  if (course.credits < 2) score -= 45;
  return score;
}

function pickSection(course: Course, taken: Pick[]): Section | null {
  const free = course.sections.filter(
    (s) => !taken.some((p) => sectionConflicts(p.section, s)),
  );
  if (free.length === 0) return null;
  // Prefer the emptiest section so the schedule is actually registerable.
  return free.reduce((a, b) =>
    b.size - b.enrolment > a.size - a.enrolment ? b : a,
  );
}

function evaluate(picks: Pick[], c: Constraints): Schedule {
  const credits = picks.reduce((n, p) => n + p.course.credits, 0);
  const rated = picks.filter((p) => p.course.rating !== null);
  const rating = rated.length
    ? rated.reduce((n, p) => n + (p.course.rating ?? 0), 0) / rated.length
    : null;
  const areasCovered = [...new Set(picks.flatMap((p) => p.course.areas))];

  let score = picks.reduce((n, p) => n + courseScore(p.course, c), 0);
  const target = c.targetCredits;
  if (target !== undefined) score -= Math.abs(credits - target) * 45;
  // Same credits spread over more courses means more work, not less.
  score -= Math.max(0, picks.length - Math.ceil(credits / 3)) * 40;
  for (const a of c.requiredAreas ?? []) if (!areasCovered.includes(a)) score -= 200;
  for (const r of c.requiredCourses ?? [])
    if (!picks.some((p) => p.course.code.startsWith(r))) score -= 400;

  return { picks, credits, rating, areasCovered, score };
}

/** Deterministic PRNG so the same prompt returns the same schedules. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const signature = (s: Schedule) =>
  s.picks.map((p) => p.course.code).sort().join("|");

/**
 * Randomised greedy with restarts. Each restart walks a score-shuffled
 * candidate list and takes any course that fits, so every returned schedule
 * is conflict-free by construction rather than by the model's say-so.
 */
export function solve(
  courses: Course[],
  c: Constraints,
  opts: { restarts?: number; want?: number } = {},
): Schedule[] {
  const restarts = opts.restarts ?? 400;
  const want = opts.want ?? 3;

  const pool = courses
    .map((x) => eligible(x, c))
    .filter((x): x is Course => x !== null)
    .map((course) => ({ course, base: courseScore(course, c) }));

  if (pool.length === 0) return [];

  const target = c.targetCredits ?? 15;
  const maxCredits = c.maxCredits ?? target + 1;
  const minCredits = c.minCredits ?? target - 1;
  // A real semester is 4-6 courses. Without this the search pads the credit
  // target with 1-credit seminars instead of picking substantive courses.
  const maxCourses = c.maxCourses ?? Math.ceil(target / 3) + 1;

  const found = new Map<string, Schedule>();
  const rand = rng(1337);

  for (let r = 0; r < restarts; r++) {
    // Temperature climbs across restarts: early passes are greedy, later ones
    // explore, which is what produces genuinely different schedules.
    const noise = (r / restarts) * 60;
    const order = pool
      .map((p) => ({ ...p, k: p.base + rand() * noise }))
      .sort((a, b) => b.k - a.k);

    const picks: Pick[] = [];
    let credits = 0;

    for (const { course } of order) {
      if (credits >= maxCredits || picks.length >= maxCourses) break;
      if (picks.some((p) => p.course.code === course.code)) continue;
      if (credits + course.credits > maxCredits) continue;
      const section = pickSection(course, picks);
      if (!section) continue;
      picks.push({ course, section });
      credits += course.credits;
    }

    if (credits < minCredits) continue;
    const sched = evaluate(picks, c);
    const sig = signature(sched);
    const prev = found.get(sig);
    if (!prev || sched.score > prev.score) found.set(sig, sched);
  }

  const ranked = [...found.values()].sort((a, b) => b.score - a.score);

  // Prefer variety: don't return three schedules that share most courses.
  const out: Schedule[] = [];
  for (const s of ranked) {
    const codes = new Set(s.picks.map((p) => p.course.code));
    const tooSimilar = out.some((o) => {
      const overlap = o.picks.filter((p) => codes.has(p.course.code)).length;
      return overlap / Math.max(codes.size, o.picks.length) > 0.45;
    });
    if (!tooSimilar) out.push(s);
    if (out.length >= want) break;
  }
  // If diversity filtering starved us, top up from the ranked list.
  for (const s of ranked) {
    if (out.length >= want) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Every meeting in a schedule, for rendering and for verification. */
export function allMeetings(s: Schedule): (Meeting & { code: string })[] {
  return s.picks.flatMap((p) =>
    p.section.meetings.map((m) => ({ ...m, code: p.course.code })),
  );
}

/** True when a schedule has any overlapping pair. Used by the self-check. */
export function hasConflict(s: Schedule): boolean {
  const ms = allMeetings(s);
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++)
      if (ms[i].code !== ms[j].code && conflicts(ms[i], ms[j])) return true;
  return false;
}
