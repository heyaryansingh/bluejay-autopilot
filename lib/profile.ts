import type { Constraints } from "./types";

export type Profile = {
  year?: string;
  major?: string;
  credits?: number;
};

export const YEARS = [
  "Freshman",
  "Sophomore",
  "Junior",
  "Senior",
  "Grad",
] as const;

/**
 * Class year maps to the course levels a student can realistically take.
 * These are ceilings and floors, not hard rules -- a sophomore may well take
 * a 300-level course, so the floor stays generous.
 */
const LEVEL_BY_YEAR: Record<string, { minLevel?: number; maxLevel?: number }> = {
  Freshman: { maxLevel: 200 },
  Sophomore: { maxLevel: 300 },
  Junior: { minLevel: 100, maxLevel: 400 },
  Senior: { minLevel: 200, maxLevel: 600 },
  Grad: { minLevel: 400 },
};

/** Turn the profile into a sentence the model folds into its own reading. */
export function profileSentence(p: Profile): string {
  const bits: string[] = [];
  if (p.year) bits.push(`The student is a ${p.year}`);
  if (p.major) bits.push(`majoring in ${p.major}`);
  if (p.credits) bits.push(`and wants about ${p.credits} credits`);
  return bits.length ? `${bits.join(" ")}.` : "";
}

/**
 * Applied after the model runs. The model's explicit reading of the request
 * always wins -- the profile only fills gaps it left blank.
 */
export function applyProfile(c: Constraints, p: Profile): Constraints {
  const out = { ...c };

  if (p.credits && out.targetCredits === undefined) out.targetCredits = p.credits;

  if (p.year) {
    const lv = LEVEL_BY_YEAR[p.year];
    if (lv?.minLevel !== undefined && out.minLevel === undefined)
      out.minLevel = lv.minLevel;
    if (lv?.maxLevel !== undefined && out.maxLevel === undefined)
      out.maxLevel = lv.maxLevel;
  }

  // Major biases course choice without excluding everything else -- a student
  // still needs distribution courses outside their department.
  if (p.major) {
    out.keywords = [...new Set([...(out.keywords ?? []), p.major])];
  }

  return out;
}
