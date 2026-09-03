import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { heuristicConstraints, heuristicVerdict } from "./heuristic";
import type { Constraints, Schedule } from "./types";

/**
 * The model does two jobs and neither is combinatorial: turn a sentence into
 * constraints, and write the verdict on a schedule the solver already proved
 * valid. Schedule construction stays in solver.ts on purpose -- a model asked
 * to place classes will happily emit overlapping ones.
 */

const DayEnum = z.enum(["M", "T", "W", "R", "F"]);

export const ConstraintsSchema = z.object({
  targetCredits: z.number().nullable(),
  minCredits: z.number().nullable(),
  maxCredits: z.number().nullable(),
  earliestStart: z.number().nullable().describe("minutes from midnight, e.g. 9am = 540"),
  latestEnd: z.number().nullable().describe("minutes from midnight, e.g. 5pm = 1020"),
  freeDays: z.array(DayEnum).describe("days that must have zero classes"),
  requiredAreas: z
    .array(z.string())
    .describe(
      "JHU distribution letters only: N natural science, S social/behavioral science, " +
        "H humanities, Q quantitative, E engineering, W writing intensive",
    ),
  requiredCourses: z.array(z.string()).describe("course code prefixes, e.g. EN.601.226"),
  excludeCourses: z.array(z.string()),
  departments: z.array(z.string()).describe("department name substrings"),
  minRating: z.number().nullable().describe("0-5 course evaluation floor"),
  avoidFull: z.boolean(),
  minLevel: z.number().nullable(),
  maxLevel: z.number().nullable(),
  writingIntensive: z.boolean(),
  keywords: z.array(z.string()).describe("topic interests to match in title/description"),
  notes: z.string().describe("anything the fields above could not capture"),
});

const VerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().describe("0-based index of the schedule being judged"),
      title: z.string().describe("3-5 word nickname, e.g. 'The Sleep Schedule'"),
      verdict: z
        .string()
        .describe(
          "One or two sentences. Blunt, specific, and grounded ONLY in the " +
            "numbers given. Name the real tradeoff. No hedging, no cheerleading.",
        ),
    }),
  ),
});

const CONSTRAINT_SYSTEM = `You convert a Johns Hopkins student's plain-English scheduling request into constraints.

Rules:
- Use null for anything the student did not express. Never invent a preference.
- "no 8ams" means earliestStart 540 (9:00). "no early classes" means 600.
- "no Friday classes" means freeDays ["F"]. Monday=M Tuesday=T Wednesday=W Thursday=R Friday=F.
- A full JHU course load is 12-18 credits; most courses are 3. If the student
  names a credit count, set targetCredits and leave min/max null.
- "professors people actually like" or similar means minRating 3.7.
- requiredAreas takes ONLY the single letters N S H Q E W. "Nat Sci" is N.
  "quant" or "math requirement" is Q. Never put a word in this array.
- Course codes look like AS.020.151 or EN.601.226.
- Put genuine topic interests in keywords, not in notes.`;

const VERDICT_SYSTEM = `You are a blunt academic advisor at Johns Hopkins reviewing schedules a solver produced.

For each schedule write a nickname and one or two sentences of honest assessment.
Ground every claim in the numbers you are given -- credits, evaluation scores,
enrollment pressure, the day/time spread. Name the actual tradeoff the student
is making. If a schedule is genuinely good, say so plainly and briefly.
Do not invent facts about courses. Do not hedge. Do not cheerlead.

If a course lists prerequisites, mention them only as something to check --
you cannot see the student's transcript, so never assert they lack them.`;

type Provider = "anthropic" | "xai" | "none";

function provider(): Provider {
  // Flip to Grok for the demo by setting LLM_PROVIDER=xai.
  if (process.env.LLM_PROVIDER === "xai") return process.env.XAI_API_KEY ? "xai" : "none";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "none";
}

/** True when no provider is configured and the app is running keyless. */
export const usingFallback = () => provider() === "none";

/** Grok is OpenAI-compatible, so it gets raw HTTP rather than the Anthropic SDK. */
async function xai(system: string, user: string, schema: object): Promise<unknown> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.XAI_MODEL ?? "grok-4",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema },
      },
    }),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

async function ask<T extends z.ZodType>(
  system: string,
  user: string,
  schema: T,
): Promise<z.infer<T>> {
  if (provider() === "xai") {
    const raw = await xai(system, user, z.toJSONSchema(schema));
    return schema.parse(raw);
  }
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (!res.parsed_output) throw new Error("model returned no parsable output");
  return res.parsed_output as z.infer<T>;
}

/** Drop nulls and empty arrays so downstream code sees only real constraints. */
function compact(raw: z.infer<typeof ConstraintsSchema>): Constraints {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (k === "avoidFull" && v === false) continue;
    if (k === "writingIntensive" && v === false) continue;
    out[k] = v;
  }
  return out as Constraints;
}

export async function parseConstraints(prompt: string): Promise<Constraints> {
  if (provider() === "none") return heuristicConstraints(prompt);
  try {
    return compact(await ask(CONSTRAINT_SYSTEM, prompt, ConstraintsSchema));
  } catch (e) {
    // Never let a provider outage end the demo -- degrade to the rule parser.
    console.error("constraint parse failed, falling back:", e);
    return heuristicConstraints(prompt);
  }
}

/** Compact, factual description of one schedule -- the only thing the judge sees. */
function describe(s: Schedule, i: number): string {
  const lines = s.picks.map((p) => {
    const days = [...new Set(p.section.meetings.map((m) => m.day))].join("");
    const start = Math.min(...p.section.meetings.map((m) => m.start));
    const hh = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")}`;
    const rating = p.course.rating ? `eval ${p.course.rating.toFixed(2)}/5` : "never evaluated";
    const seats = `${p.section.enrolment}/${p.section.size} seats taken`;
    const react = Object.entries(p.course.reactions)
      .map(([k, v]) => `${k}x${v}`)
      .join(" ");
    const pre = p.course.prereqs.length
      ? `, listed prerequisites: ${p.course.prereqs.slice(0, 5).join(" ")}`
      : "";
    return `  - ${p.course.code} ${p.course.name} (${p.course.credits}cr, ${days} ${hh}, ${rating}, ${seats}${react ? `, student reactions: ${react}` : ""}${pre})`;
  });
  return `Schedule ${i}: ${s.credits} credits, mean eval ${
    s.rating ? s.rating.toFixed(2) : "n/a"
  }, distribution areas ${s.areasCovered.join("") || "none"}\n${lines.join("\n")}`;
}

export async function judge(
  schedules: Schedule[],
  prompt: string,
): Promise<Schedule[]> {
  if (schedules.length === 0) return schedules;
  if (provider() === "none")
    return schedules.map((s) => ({ ...s, ...heuristicVerdict(s) }));
  const user = `The student asked: "${prompt}"\n\n${schedules
    .map((s, i) => describe(s, i))
    .join("\n\n")}`;
  try {
    const { verdicts } = await ask(VERDICT_SYSTEM, user, VerdictSchema);
    return schedules.map((s, i) => {
      const v = verdicts.find((x) => x.index === i);
      return { ...s, title: v?.title, verdict: v?.verdict };
    });
  } catch {
    // A missing verdict is cosmetic; never fail the whole request over it.
    return schedules.map((s) => ({ ...s, ...heuristicVerdict(s) }));
  }
}
