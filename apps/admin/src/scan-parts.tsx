import { Flame, TriangleAlert } from "lucide-react";
import { STREAK_CAP, fmtDate, fmtNum, wibDaysAgo, type AdminUser, type Plan } from "./api";
import { Badge } from "./ui";

// Same heuristics as the server (admin.ts ABUSE_TODAY / ABUSE_7D).
export const ABUSE_TODAY = 50;
export const ABUSE_7D = 300;

const PLAN_LABEL: Record<Plan, string> = { paid: "Paid", founder: "Founder (comp)", free: "Free" };

export function PlanBadge({ user }: { user: AdminUser }) {
  return (
    <span className="inline-flex flex-wrap items-start gap-1">
      <Badge tone={user.plan === "free" ? "muted" : "green"}>{PLAN_LABEL[user.plan]}</Badge>
      {user.plan === "paid" && user.manualTier === "founder" && <Badge tone="amber">comp</Badge>}
      {user.aiUnlimited && <Badge tone="amber">AI unlimited</Badge>}
    </span>
  );
}

/** Scan count, flagged red when it crosses the abuse threshold. */
export function ScanCount({ value, flagAt }: { value: number; flagAt: number }) {
  return value >= flagAt ? (
    <Badge tone="red" className="tabular-nums">
      <TriangleAlert className="size-3" />
      {fmtNum(value)}
    </Badge>
  ) : (
    <>{fmtNum(value)}</>
  );
}

export const founderUntilNote = (u: AdminUser) =>
  u.plan === "paid" && u.founderUntil !== null ? `until ${fmtDate(u.founderUntil)}` : null;

/** Zero is dimmed: the point of these columns is spotting who did not scan. */
export function DayScans({ value }: { value: number }) {
  return value === 0 ? <span className="text-muted-foreground">0</span> : <ScanCount value={value} flagAt={ABUSE_TODAY} />;
}

/** A run longer than the server window shows as "60+". */
export function Streak({ days }: { days: number }) {
  if (days === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Flame className="size-3.5 text-amber-500" aria-hidden />
      {days >= STREAK_CAP ? `${STREAK_CAP}+` : days}
    </span>
  );
}

/** "Hari ini" / "Kemarin" / "5 hari lalu" for the newest scan; "Belum pernah" when there is none. */
function lastScanAgo(u: AdminUser): string {
  const ago = wibDaysAgo(u.lastScanAt);
  if (ago === null) return "Belum pernah";
  if (ago === 0) return "Hari ini";
  if (ago === 1) return "Kemarin";
  return `${ago} hari lalu`;
}

export function LastScan({ user }: { user: AdminUser }) {
  return (
    <>
      <div>{lastScanAgo(user)}</div>
      {user.lastScanAt !== null && (wibDaysAgo(user.lastScanAt) ?? 0) > 1 && (
        <div className="text-[0.6875rem] text-muted-foreground">{fmtDate(user.lastScanAt)}</div>
      )}
    </>
  );
}

