import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Live seat counts for the handful of courses currently on screen.
 *
 * The snapshot in data/catalog.json goes stale on enrolment numbers within
 * hours. Re-crawling all 497 departments to fix that is absurd, so this
 * re-reads only the courses the user is actually looking at.
 */
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "no course ids" }, { status: 400 });
  }
  // Bound the fan-out so a crafted request can't turn us into a scraper.
  const wanted = ids.slice(0, 24);
  const { meta } = getCatalog();
  const { name, year } = meta.semester;

  const results = await Promise.all(
    wanted.map(async (id) => {
      try {
        const res = await fetch(
          `https://jhu.semester.ly/courses/${name}/${year}/id/${id}`,
          { headers: { Accept: "application/json" }, cache: "no-store" },
        );
        if (!res.ok) return null;
        const course = await res.json();
        return {
          id,
          sections: (course.sections ?? []).map(
            (s: { id: number; size: number; enrolment: number; waitlist: number }) => ({
              id: s.id,
              size: s.size,
              enrolment: s.enrolment,
              waitlist: s.waitlist,
            }),
          ),
        };
      } catch {
        return null;
      }
    }),
  );

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    courses: results.filter(Boolean),
  });
}
