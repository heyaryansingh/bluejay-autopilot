// Shapes returned by the public jhu.semester.ly API, plus our normalized forms.

export type RawOffering = {
  id: number;
  day: string; // "M" | "T" | "W" | "R" | "F" | "S" | "U"
  time_start: string; // "13:30"
  time_end: string;
  location: string;
  is_short_course: boolean;
};

export type RawSection = {
  id: number;
  meeting_section: string; // "(01)"
  size: number;
  enrolment: number;
  waitlist: number;
  section_type: string; // "L" lecture, others are lab/section
  instructors: string;
  offering_set: RawOffering[];
};

export type RawEval = {
  score: number;
  professor: string;
  year: string; // "Fall:2022"
};

export type RawCourse = {
  id: number;
  code: string; // "EN.601.433"
  name: string;
  description: string;
  department: string;
  num_credits: number;
  areas: string[]; // char-exploded upstream; see normalizeAreas
  evals: RawEval[];
  reactions: { title: string; count: number }[];
  regexed_courses: Record<string, string>; // prereq codes -> titles
  popularity_percent: number;
  sections: RawSection[];
};

export type Catalog = {
  semester: { name: string; year: string };
  crawled_at: string;
  last_updated: string;
  source: string;
  courses: RawCourse[];
};

export const DAYS = ["M", "T", "W", "R", "F"] as const;
export type Day = (typeof DAYS)[number];

/** A concrete meeting block, minutes from midnight. */
export type Meeting = { day: Day; start: number; end: number; location: string };

export type Section = {
  id: number;
  label: string;
  type: string;
  instructors: string[];
  size: number;
  enrolment: number;
  waitlist: number;
  /** true when enrolment >= size */
  full: boolean;
  meetings: Meeting[];
};

export type Course = {
  id: number;
  code: string;
  name: string;
  description: string;
  department: string;
  credits: number;
  /** JHU distribution letters: H N S Q E, plus a synthesised W. */
  areas: string[];
  /** Named foci, e.g. "Science and Data", "Ethics and Foundations". */
  foci: string[];
  level: number; // 100..900, from the course number
  writingIntensive: boolean;
  /** Mean of all historical evaluation scores, 0-5. null when never evaluated. */
  rating: number | null;
  ratingCount: number;
  /** Best-known rating per instructor name. */
  profRatings: Record<string, number>;
  reactions: Record<string, number>;
  prereqs: string[];
  popularity: number;
  /** Only sections that actually meet at a known time. */
  sections: Section[];
};

/** What the model extracts from the user's sentence. Every field optional. */
export type Constraints = {
  targetCredits?: number;
  minCredits?: number;
  maxCredits?: number;
  /** Minutes from midnight; no class may start before this. */
  earliestStart?: number;
  /** Minutes from midnight; no class may end after this. */
  latestEnd?: number;
  /** Days that must stay completely free. */
  freeDays?: Day[];
  /** Distribution letters the schedule must cover. */
  requiredAreas?: string[];
  requiredCourses?: string[];
  excludeCourses?: string[];
  departments?: string[];
  /** Drop any course whose mean eval is below this. */
  minRating?: number;
  /** Skip sections with no seats left. */
  avoidFull?: boolean;
  maxLevel?: number;
  minLevel?: number;
  /** Cap on number of courses; defaults to a sane 4-6 for the credit target. */
  maxCourses?: number;
  writingIntensive?: boolean;
  /** Free-text interests, matched against title + description. */
  keywords?: string[];
  notes?: string;
};

export type Pick = { course: Course; section: Section };

export type Schedule = {
  picks: Pick[];
  credits: number;
  /** Mean rating across rated picks. */
  rating: number | null;
  areasCovered: string[];
  score: number;
  /** Populated by the model after solving. */
  verdict?: string;
  title?: string;
};
