import type {
  Catalog,
  Course,
  Day,
  Meeting,
  RawCourse,
  RawSection,
  Section,
} from "./types";
import { DAYS } from "./types";

/**
 * Upstream returns `areas` char-exploded and space-stripped, e.g.
 * "EQ, Science and Data" arrives as ["E","Q",",","S","c","i",...].
 *
 * Rejoined, it is a comma-separated mix of two different things:
 *   - distribution codes: 1-3 uppercase letters ("N", "EQ", "HS"). A
 *     multi-letter code means the course counts toward each of those areas.
 *   - named foci: "ScienceandData", "EthicsandFoundations", ...
 *
 * Splitting naively on the first comma turns "EthicsandFoundations" into the
 * letters E,T,H,I,C,S and reports Psychology as an Engineering course.
 */
const FOCI: Record<string, string> = {
  ScienceandData: "Science and Data",
  CitizensandSociety: "Citizens and Society",
  WritingandCommunication: "Writing and Communication",
  EthicsandFoundations: "Ethics and Foundations",
  EngagementwithSociety: "Engagement with Society",
  ProjectsandMethods: "Projects and Methods",
  CultureandAesthetics: "Culture and Aesthetics",
  CreativeExpression: "Creative Expression",
  Democracy: "Democracy",
  EthicalReflection: "Ethical Reflection",
  ConceivingofandRealizingProjectsePortfolio:
    "Conceiving of and Realizing Projects (ePortfolio)",
  WritingePortfolio: "Writing (ePortfolio)",
  OralCommunicationePortfolio: "Oral Communication (ePortfolio)",
  EthicalReflectionePortfolio: "Ethical Reflection (ePortfolio)",
};

/** The only distribution letters JHU actually issues. */
const DIST = new Set(["H", "N", "S", "Q", "E"]);

export function normalizeAreas(raw: string[]): {
  areas: string[];
  foci: string[];
} {
  const joined = raw.join("");
  if (!joined) return { areas: [], foci: [] };

  const areas = new Set<string>();
  const foci: string[] = [];

  for (const token of joined.split(",")) {
    const t = token.trim();
    if (!t) continue;
    if (/^[A-Z]{1,3}$/.test(t) && [...t].every((ch) => DIST.has(ch))) {
      for (const ch of t) areas.add(ch);
    } else {
      foci.push(FOCI[t] ?? t);
    }
  }

  // JHU issues no "W" distribution code -- writing-intensive shows up as a
  // focus. Synthesising the letter lets one code path serve both.
  if (foci.includes("Writing and Communication")) areas.add("W");

  return { areas: [...areas], foci };
}

/** "13:30" -> 810. Returns null for blank/garbage so callers can drop it. */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function fromMinutes(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 < 12 ? "am" : "pm";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

const isDay = (d: string): d is Day => (DAYS as readonly string[]).includes(d);

function normalizeSection(s: RawSection): Section | null {
  const meetings: Meeting[] = [];
  for (const o of s.offering_set) {
    const start = toMinutes(o.time_start);
    const end = toMinutes(o.time_end);
    // Weekend and TBA offerings can't be placed on a Mon-Fri grid.
    if (start === null || end === null || end <= start || !isDay(o.day)) continue;
    meetings.push({ day: o.day, start, end, location: o.location || "TBA" });
  }
  // A section with no placeable meeting can't be scheduled around.
  if (meetings.length === 0) return null;

  return {
    id: s.id,
    label: s.meeting_section.replace(/[()]/g, ""),
    type: s.section_type,
    instructors: (s.instructors ?? "")
      // Upstream concatenates names without a separator ("M. DinitzJ. Sorrell").
      // Split where a lowercase letter butts against an initial.
      .replace(/([a-z])([A-Z]\.)/g, "$1|$2")
      .split(/[|,;]/)
      .map((x) => x.trim())
      .filter(Boolean),
    size: s.size,
    enrolment: s.enrolment,
    waitlist: s.waitlist,
    full: s.size > 0 && s.enrolment >= s.size,
    meetings,
  };
}

function normalizeCourse(c: RawCourse): Course | null {
  const sections = c.sections
    .map(normalizeSection)
    .filter((s): s is Section => s !== null);
  if (sections.length === 0) return null;

  const { areas, foci } = normalizeAreas(c.areas);

  const scores = c.evals.map((e) => e.score).filter((n) => Number.isFinite(n));
  const rating = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : null;

  // Keep the best score seen per professor -- evals repeat across terms.
  const profRatings: Record<string, number> = {};
  for (const e of c.evals) {
    if (!e.professor || !Number.isFinite(e.score)) continue;
    profRatings[e.professor] = Math.max(profRatings[e.professor] ?? 0, e.score);
  }

  const reactions: Record<string, number> = {};
  for (const r of c.reactions) reactions[r.title] = r.count;

  const num = Number(c.code.split(".")[2] ?? 0);

  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description ?? "",
    department: c.department ?? "",
    credits: c.num_credits > 0 ? c.num_credits : 3,
    areas,
    foci,
    level: Math.floor(num / 100) * 100,
    writingIntensive: areas.includes("W"),
    rating,
    ratingCount: scores.length,
    profRatings,
    reactions,
    prereqs: Object.keys(c.regexed_courses ?? {}).filter((p) => p !== c.code),
    popularity: c.popularity_percent ?? 0,
    sections,
  };
}

export function normalizeCatalog(raw: Catalog): Course[] {
  return raw.courses
    .map(normalizeCourse)
    .filter((c): c is Course => c !== null);
}
