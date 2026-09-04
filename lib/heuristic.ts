import type { Constraints, Day, Schedule } from "./types";

/**
 * Keyless fallback for constraint parsing.
 *
 * The model is the real path -- it handles phrasing this never will. This
 * exists so a rate limit or a dead venue network degrades the demo instead of
 * ending it, and so the solver can be exercised in tests without a key.
 */

const DAY_WORDS: [RegExp, Day][] = [
  [/\bmon(day)?s?\b/i, "M"],
  [/\btue(s|sday)?s?\b/i, "T"],
  [/\bwed(nesday)?s?\b/i, "W"],
  [/\bthu(r|rs|rsday)?s?\b/i, "R"],
  [/\bfri(day)?s?\b/i, "F"],
];

const AREA_WORDS: [RegExp, string][] = [
  [/\bnat(ural)?\.?\s*sci(ence)?\b|\bnatural science\b/i, "N"],
  [/\bsocial science\b|\bbehavio(u)?ral\b|\bsoc sci\b/i, "S"],
  [/\bhumanities\b|\bhuman(ity)?\s+req\b/i, "H"],
  [/\bquant(itative)?\b|\bmath req\b/i, "Q"],
  [/\bengineering req\b/i, "E"],
  [/\bwriting intensive\b|\bwriting req\b/i, "W"],
];

const TOPIC_WORDS = [
  "brain", "neuro", "machine learning", "ai", "robot", "climate", "history",
  "philosophy", "music", "film", "economics", "law", "genetics", "cancer",
  "physics", "quantum", "data", "security", "algorithms", "art", "poetry",
  "psychology", "biology", "chemistry", "space", "astronomy", "language",
];

/** "8am" / "9:30" / "5 pm" -> minutes from midnight. */
function clock(hour: string, minute: string | undefined, ap: string | undefined) {
  let h = Number(hour);
  if (ap?.toLowerCase().startsWith("p") && h < 12) h += 12;
  if (ap?.toLowerCase().startsWith("a") && h === 12) h = 0;
  return h * 60 + Number(minute ?? 0);
}

export function heuristicConstraints(text: string, reason?: string): Constraints {
  const c: Constraints = {};
  const t = text.toLowerCase();

  const credits = /(\d{1,2}(?:\.\d)?)\s*(?:credit|cr\b|units?)/i.exec(text);
  if (credits) c.targetCredits = Number(credits[1]);

  // "no 8ams", "nothing before 10", "no early classes"
  const noBefore =
    /no\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?s?\b/i.exec(text) ??
    /(?:nothing|not?hing|no class(?:es)?)\s+before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (noBefore) {
    // "no 8ams" means the earliest acceptable start is the next hour.
    const at = clock(noBefore[1], noBefore[2], noBefore[3] ?? "am");
    c.earliestStart = /before/i.test(noBefore[0]) ? at : at + 60;
  } else if (/\bno early\b|\bnot? a morning person\b|\bsleep in\b/i.test(t)) {
    c.earliestStart = 600;
  }

  const doneBy = /(?:done|finish(?:ed)?|out|end)\s+by\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (doneBy) c.latestEnd = clock(doneBy[1], doneBy[2], doneBy[3] ?? "pm");
  else if (/\bafternoons? only\b/i.test(t)) c.earliestStart = 720;

  const free: Day[] = [];
  for (const [re, day] of DAY_WORDS) {
    // "no friday classes" / "nothing on friday" / "friday off"
    const near = new RegExp(
      `(?:no|nothing on|free|off|without)\\s+\\w{0,8}\\s*${re.source}|${re.source}\\s*(?:off|free)`,
      "i",
    );
    if (near.test(text)) free.push(day);
  }
  if (free.length) c.freeDays = [...new Set(free)];

  const areas = AREA_WORDS.filter(([re]) => re.test(text)).map(([, a]) => a);
  if (areas.length) c.requiredAreas = [...new Set(areas)];
  if (areas.includes("W")) c.writingIntensive = true;

  const codes = text.match(/\b(?:AS|EN)\.\d{3}\.\d{3}\b/gi);
  if (codes) c.requiredCourses = codes.map((x) => x.toUpperCase());

  if (/\bactually like\b|\bgood professors?\b|\bwell.?rated\b|\bhighly rated\b/i.test(text))
    c.minRating = 3.7;

  if (/\bopen seats?\b|\bnot full\b|\bcan actually register\b/i.test(text))
    c.avoidFull = true;

  if (/\bhard(est)?\b|\bsuffer\b|\bchalleng/i.test(text)) c.minLevel = 300;
  if (/\beasy\b|\blight\b|\bchill\b|\bgpa boost\b/i.test(text)) c.maxLevel = 200;

  const kw = TOPIC_WORDS.filter((w) => t.includes(w));
  if (kw.length) c.keywords = kw;

  c.notes = reason ?? "Parsed without a model.";
  return c;
}

/** Plain factual verdict, used when the model is unavailable. */
export function heuristicVerdict(s: Schedule): { title: string; verdict: string } {
  const days = new Set(s.picks.flatMap((p) => p.section.meetings.map((m) => m.day)));
  const starts = s.picks.flatMap((p) => p.section.meetings.map((m) => m.start));
  const earliest = Math.min(...starts);
  const full = s.picks.filter((p) => p.section.full).length;

  const title =
    days.size <= 3 ? "The Compact Week"
    : earliest >= 660 ? "The Late Riser"
    : s.rating && s.rating >= 4.2 ? "The Well-Reviewed One"
    : `${s.credits} Credits`;

  const parts = [
    `${s.credits} credits across ${s.picks.length} courses on ${days.size} days`,
  ];
  if (s.rating) parts.push(`mean evaluation ${s.rating.toFixed(2)} of 5`);
  parts.push(`earliest class ${Math.floor(earliest / 60)}:${String(earliest % 60).padStart(2, "0")}`);
  if (full) parts.push(`${full} section${full > 1 ? "s" : ""} already full`);

  return { title, verdict: `${parts.join(", ")}.` };
}
