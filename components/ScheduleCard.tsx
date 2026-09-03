"use client";

import { fromMinutes } from "@/lib/catalog";
import type { Schedule } from "@/lib/types";
import WeekGrid from "./WeekGrid";

const AREA_NAMES: Record<string, string> = {
  H: "Humanities",
  N: "Natural Science",
  S: "Social & Behavioral",
  Q: "Quantitative",
  E: "Engineering",
  W: "Writing Intensive",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="display text-xl leading-tight">{value}</div>
    </div>
  );
}

export default function ScheduleCard({
  schedule,
  index,
  live,
}: {
  schedule: Schedule;
  index: number;
  /** Freshly-checked enrolment, keyed by section id. Overrides the snapshot. */
  live?: Record<number, { size: number; enrolment: number }>;
}) {
  const seatPressure = schedule.picks.filter((p) => p.section.full).length;

  return (
    <article
      className="card rise p-5 sm:p-6"
      style={{ animationDelay: `${index * 110}ms` }}
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="label">Option {String(index + 1).padStart(2, "0")}</div>
          <h3 className="display text-2xl sm:text-[1.7rem]">
            {schedule.title ?? `${schedule.credits} credits`}
          </h3>
        </div>
        <div className="flex gap-6">
          <Stat label="Credits" value={String(schedule.credits)} />
          <Stat
            label="Mean eval"
            value={schedule.rating ? `${schedule.rating.toFixed(2)}` : "—"}
          />
          <Stat label="Courses" value={String(schedule.picks.length)} />
        </div>
      </header>

      {schedule.verdict && (
        <blockquote className="mb-5 border-l-2 border-gold pl-3 text-[0.95rem] leading-relaxed text-ink-soft italic">
          {schedule.verdict}
        </blockquote>
      )}

      <WeekGrid schedule={schedule} />

      <div className="rule-double mt-5 pt-3">
        <table className="w-full text-left text-[0.82rem]">
          <thead>
            <tr className="label">
              <th className="pb-1 font-normal">Course</th>
              <th className="pb-1 font-normal">Instructor</th>
              <th className="pb-1 text-right font-normal">Eval</th>
              <th className="pb-1 text-right font-normal">Seats</th>
            </tr>
          </thead>
          <tbody>
            {schedule.picks.map(({ course, section }) => {
              const now = live?.[section.id];
              const open = now
                ? now.size - now.enrolment
                : section.size - section.enrolment;
              return (
                <tr key={course.code} className="border-t border-rule align-top">
                  <td className="py-1.5 pr-3">
                    <span className="mono text-[0.76rem] text-blue">
                      {course.code}
                    </span>{" "}
                    <span className="font-500">{course.name}</span>
                    <div className="mono text-[0.68rem] text-ink-faint">
                      {[...new Set(section.meetings.map((m) => m.day))].join("")}{" "}
                      {fromMinutes(Math.min(...section.meetings.map((m) => m.start)))}
                      {" · "}
                      {section.meetings[0].location}
                      {course.areas.length > 0 &&
                        ` · ${course.areas.map((a) => AREA_NAMES[a] ?? a).join(", ")}`}
                      {course.foci.length > 0 && ` · ${course.foci.join(", ")}`}
                    </div>
                    {course.prereqs.length > 0 && (
                      <div className="mono text-[0.68rem] text-gold">
                        needs {course.prereqs.slice(0, 4).join(" · ")}
                        {course.prereqs.length > 4 && ` +${course.prereqs.length - 4}`}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-[0.78rem] text-ink-soft">
                    {section.instructors.join(", ") || "TBA"}
                  </td>
                  <td className="mono py-1.5 text-right tabular-nums">
                    {course.rating ? (
                      course.rating.toFixed(2)
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td
                    className={`mono py-1.5 text-right tabular-nums ${
                      open <= 0 ? "text-crimson" : "text-ink-soft"
                    }`}
                  >
                    {open <= 0 ? "FULL" : open}
                    {now && <span className="ml-1 text-gold">•</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] text-ink-faint">
        <span>
          Areas covered:{" "}
          {schedule.areasCovered.length
            ? schedule.areasCovered.map((a) => AREA_NAMES[a] ?? a).join(" · ")
            : "none listed"}
        </span>
        {seatPressure > 0 && (
          <span className="text-crimson">
            {seatPressure} section{seatPressure > 1 ? "s" : ""} already full
          </span>
        )}
      </footer>
    </article>
  );
}
