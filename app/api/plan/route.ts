import { NextResponse } from "next/server";
import { judge, parseConstraints } from "@/lib/llm";
import { hasConflict, solve } from "@/lib/solver";
import { applyProfile, profileSentence, type Profile } from "@/lib/profile";
import { getCatalog } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { prompt, profile = {} } = (await req.json()) as {
    prompt?: string;
    profile?: Profile;
  };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "empty prompt" }, { status: 400 });
  }

  const { courses, meta } = getCatalog();

  const context = profileSentence(profile);
  let constraints;
  try {
    constraints = applyProfile(
      await parseConstraints(context ? `${context}

${prompt}` : prompt),
      profile,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `could not read that request: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const schedules = solve(courses, constraints);

  // The solver is meant to make this impossible. If it ever fires, the bug is
  // ours and we would rather know than ship an overlapping schedule.
  const broken = schedules.filter(hasConflict);
  if (broken.length) {
    return NextResponse.json(
      { error: "solver produced a conflicting schedule", constraints },
      { status: 500 },
    );
  }

  const judged = await judge(schedules, prompt);

  return NextResponse.json({
    constraints,
    semester: meta.semester,
    lastUpdated: meta.last_updated,
    poolSize: courses.length,
    schedules: judged,
  });
}
