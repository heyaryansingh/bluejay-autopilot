"use client";

import { fromMinutes } from "@/lib/catalog";
import type { Day, Schedule } from "@/lib/types";

const DAYS: { key: Day; label: string }[] = [
  { key: "M", label: "Mon" },
  { key: "T", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "R", label: "Thu" },
  { key: "F", label: "Fri" },
];

/* Muted, ink-on-paper blocks so a full grid never turns into confetti. */
const INKS = [
  { bg: "#002d72", fg: "#f4f1e8" },
  { bg: "#9a6b12", fg: "#fdf8ec" },
  { bg: "#3c6255", fg: "#f2f6f1" },
  { bg: "#8f2b2b", fg: "#fbf0ee" },
  { bg: "#4a3f78", fg: "#f3f1fa" },
  { bg: "#1d4b91", fg: "#eef3fb" },
  { bg: "#6a5326", fg: "#faf5e9" },
];

export default function WeekGrid({ schedule }: { schedule: Schedule }) {
  const blocks = schedule.picks.flatMap((p, i) =>
    p.section.meetings.map((m) => ({
      ...m,
      code: p.course.code,
      name: p.course.name,
      room: m.location,
      ink: INKS[i % INKS.length],
    })),
  );

  if (blocks.length === 0) return null;

  // Frame the day to the classes actually present, padded to whole hours.
  const lo = Math.floor(Math.min(...blocks.map((b) => b.start)) / 60) * 60;
  const hi = Math.ceil(Math.max(...blocks.map((b) => b.end)) / 60) * 60;
  const span = Math.max(hi - lo, 60);
  const hours = Array.from(
    { length: Math.floor(span / 60) + 1 },
    (_, i) => lo + i * 60,
  );
  const pct = (mins: number) => ((mins - lo) / span) * 100;

  return (
    <div className="flex gap-2 select-none">
      {/* Hour gutter */}
      <div className="relative w-11 shrink-0" style={{ height: span * 0.62 }}>
        {hours.map((h) => (
          <div
            key={h}
            className="mono absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-ink-faint"
            style={{ top: `${pct(h)}%` }}
          >
            {fromMinutes(h).replace(":00", "")}
          </div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-5 gap-px bg-rule">
        {DAYS.map(({ key, label }) => (
          <div key={key} className="bg-card">
            <div className="label border-b border-rule py-1 text-center">
              {label}
            </div>
            <div className="relative" style={{ height: span * 0.62 }}>
              {/* Hour rules */}
              {hours.slice(1, -1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-dotted border-rule"
                  style={{ top: `${pct(h)}%` }}
                />
              ))}

              {blocks
                .filter((b) => b.day === key)
                .map((b, i) => (
                  <div
                    key={`${b.code}-${i}`}
                    title={`${b.code} ${b.name}\n${fromMinutes(b.start)}–${fromMinutes(b.end)}\n${b.room}`}
                    className="absolute inset-x-[3px] overflow-hidden rounded-[3px] px-1.5 py-1 leading-tight transition-transform hover:z-10 hover:scale-[1.03]"
                    style={{
                      top: `${pct(b.start)}%`,
                      height: `${((b.end - b.start) / span) * 100}%`,
                      background: b.ink.bg,
                      color: b.ink.fg,
                    }}
                  >
                    <div className="mono truncate text-[10px] font-600 tracking-tight">
                      {b.code.split(".").slice(1).join(".")}
                    </div>
                    <div className="truncate text-[10px] opacity-85">
                      {b.name}
                    </div>
                    <div className="mono truncate text-[9px] opacity-70">
                      {fromMinutes(b.start)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
