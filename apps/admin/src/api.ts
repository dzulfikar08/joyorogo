import { SERVER_URL } from "./auth-client";

/** All admin endpoints are same-credentialed XHRs against the main API. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** drizzle timestamp_ms JSON gives ISO strings; raw subqueries give ms. */
export function toDate(x: number | string | null | undefined): Date | null {
  if (x === null || x === undefined) return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Operators read WIB regardless of the browser's timezone. */
const WIB = "Asia/Jakarta";
const wibYear = (d: Date) =>
  new Intl.DateTimeFormat("en", { timeZone: WIB, year: "numeric" }).format(d);
const dateFormat = (withYear: boolean) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
const dateTimeFormat = (withYear: boolean) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const formats = {
  date: [dateFormat(false), dateFormat(true)],
  dateTime: [dateTimeFormat(false), dateTimeFormat(true)],
} as const;

/** "17 Okt 14.05 WIB"; the year shows only when it is not the current WIB year. */
export function fmtDateTime(x: number | string | null | undefined): string {
  const d = toDate(x);
  if (!d) return "—";
  return `${formats.dateTime[wibYear(d) === wibYear(new Date()) ? 0 : 1].format(d)} WIB`;
}

/** "17 Okt" (WIB calendar day); the year shows only when it is not the current WIB year. */
export function fmtDate(x: number | string | null | undefined): string {
  const d = toDate(x);
  if (!d) return "—";
  return formats.date[wibYear(d) === wibYear(new Date()) ? 0 : 1].format(d);
}

const numberFormat = new Intl.NumberFormat("id-ID");
const compactFormat = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const idrFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** 1234567 -> "1.234.567" */
export const fmtNum = (n: number | null | undefined) => numberFormat.format(n ?? 0);
export const fmtCompact = (n: number) => compactFormat.format(n);
/** 15000 -> "Rp 15.000" */
export const fmtIdr = (n: number | null | undefined) => idrFormat.format(n ?? 0);

/** Calendar day keys (YYYY-MM-DD, WIB) for the last `n` days, oldest first. */
export function lastWibDays(n: number): string[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const wibNow = Date.now() + 7 * 60 * 60 * 1000;
  return Array.from({ length: n }, (_, i) =>
    new Date(wibNow - (n - 1 - i) * dayMs).toISOString().slice(0, 10),
  );
}

/** Message for a failed request, without the "Error:" prefix `String(err)` adds. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Tidak bisa terhubung ke server.";
  return err instanceof Error ? err.message : String(err);
}

// ---- response types (server API contract) ----

export interface Overview {
  users: number;
  signupsToday: number;
  signups7d: number;
  onboarded: number;
  activeToday: number;
  founders: number;
  scansToday: number;
  scans7d: number;
  anonScansToday: number;
  pendingOrders: number;
  paidOrders: number;
  revenueIdr: number;
}

export interface UsageDay {
  day: string;
  scans: number;
  scanUsers: number;
  signups: number;
  paid: number;
  revenueIdr: number;
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  /** Profile photo: /avatar/... (custom upload, prefix with SERVER_URL) or an absolute Google URL. */
  image?: string | null;
  /** Effective tier: "founder" while any paid period is active. */
  tier: "free" | "founder";
  /** Raw comp column; "founder" here means manually granted. */
  manualTier: "free" | "founder";
  /** Detail endpoint echoes the effective tier; falls back to `tier`. */
  effectiveTier?: "free" | "founder";
  founderUntil: string | number | null;
  aiUnlimited: boolean;
  createdAt: string | number;
  lastSeen: string | number | null;
  scansToday: number;
  scans7d: number;
  scansTotal: number;
  foodLogs: number;
  onboarded: 0 | 1;
  pendingOrders: number;
  paidOrders: number;
}

export interface AiCall {
  createdAt: string | number;
  scanType: string;
  model: string;
  latencyMs: number;
  kind: "photo" | "text" | "voice";
}

/** One WIB day of "Hasilnya akurat?" answers (dismissals excluded). */
export interface FeedbackDay {
  day: string;
  total: number;
  akurat: number;
  kurang: number;
  salah: number;
}

export interface FeedbackModelRow {
  model: string | null;
  total: number;
  akurat: number;
  kurang: number;
  salah: number;
}

export interface CompactItem {
  n: string;
  g?: number;
  k: number;
  /** Protein, carbs, fat, fiber (g). */
  p?: number;
  c?: number;
  f?: number;
  fi?: number;
  /** Model confidence 0-1. */
  cf?: number;
}

/** What the user changed between the model's answer and the diary. */
export interface ScanDiff {
  renamed: { from: CompactItem; to: CompactItem }[];
  removed: CompactItem[];
  added: CompactItem[];
  changed: { n: string; g?: [number, number]; k?: [number, number] }[];
  aiKcal: number;
  savedKcal: number;
}

export interface RetryPass {
  i: number;
  at: number;
  model: string;
  hint?: string;
  items: CompactItem[];
}

/** One corrected scan session (photo-independent); newest first via /api/admin/feedback/corrected. */
export interface CorrectedScan {
  id: string;
  createdAt: string | number;
  model: string | null;
  userId: string | null;
  userName: string | null;
  photoId: string | null;
  retries: number;
  corrections: number;
  savedAt: number | null;
  aiItems: CompactItem[] | null;
  retryLog: RetryPass[] | null;
  savedItems: CompactItem[] | null;
  diff: ScanDiff | null;
}

/** One negative scan result; photo served by /api/admin/feedback-photo. */
export interface FeedbackNegative {
  id: string;
  createdAt: string | number;
  rating: "kurang_akurat" | "salah";
  /** The user's reasons, without reserved marks. */
  reasons: string[];
  note: string | null;
  afterRetry: boolean;
  /** Only a "Hitung ulang" tap (old client / legacy row), not a real verdict. */
  retryDerived: boolean;
  keptPhoto: boolean;
  model: string | null;
  source: string;
  photoId: string;
  userId: string;
  userName: string | null;
  /** Scan session fields; null when the scan has no session (older than the outcome tracking). */
  aiItems: CompactItem[] | null;
  retryItems: CompactItem[] | null;
  /** Every "Hitung ulang" pass, in order. */
  retryLog: RetryPass[] | null;
  savedItems: CompactItem[] | null;
  diff: ScanDiff | null;
}

export interface OutcomeCounts {
  accurate: number;
  corrected: number;
  retried: number;
  abandoned: number;
  pending: number;
}

/** Plate-level kcal error of corrected sessions; positive % = AI above what the user saved. */
export interface KcalBias {
  n: number;
  over: number;
  under: number;
  meanPct: number | null;
  meanOverPct: number | null;
  meanUnderPct: number | null;
}

export interface FeedbackScan {
  days: number;
  /** Explicit ratings per day/model, retry-derived rows excluded. */
  byDay: FeedbackDay[];
  byModel: FeedbackModelRow[];
  explicit: { total: number; akurat: number; kurang: number; salah: number };
  /** Ratings in the window that only recorded a "Hitung ulang" tap. */
  retryLegacy: number;
  /** All-time negative results (the list pages through /api/admin/feedback/negatives). */
  negatives: { total: number; afterRetry: number };
  outcomes: {
    total: OutcomeCounts;
    byDay: (OutcomeCounts & { day: string })[];
    byModel: (OutcomeCounts & { model: string | null })[];
  };
  bias: {
    total: KcalBias;
    byModel: (KcalBias & { model: string | null })[];
  };
}

export interface FoodLog {
  date: string;
  meal: string;
  name: string;
  kcal: number;
  source: string;
  createdAt: string | number;
}

export interface AdminOrder {
  orderId: string;
  userId?: string;
  name: string | null;
  email: string;
  amountIdr: number;
  status: string;
  paymentUrl: string | null;
  createdAt: string | number;
  paidAt: string | number | null;
  founderUntil: string | number | null;
}

/**
 * How an order was paid, read from what the server stores: Apple orders are
 * "apple:<txn>", Pakasir links live on app.pakasir.com (the QRIS button adds
 * qris_only=1), anything else with a link is DOKU (the Transfer Bank button;
 * DOKU's page can still offer other methods). No link = checkout never opened.
 */
export function orderMethod(o: Pick<AdminOrder, "orderId" | "paymentUrl">): string {
  if (o.orderId.startsWith("apple:")) return "Apple";
  if (!o.paymentUrl) return "—";
  if (o.paymentUrl.includes("app.pakasir.com")) {
    return o.paymentUrl.includes("qris_only=1") ? "QRIS (Pakasir)" : "Pakasir";
  }
  return "Transfer Bank (DOKU)";
}

export interface AdminSession {
  createdAt: string | number;
  updatedAt: string | number;
  userAgent: string | null;
  ipAddress: string | null;
}

/** An order as listed under one user (the user is implied). */
export type UserOrder = Omit<AdminOrder, "name" | "email">;

export interface UserDetail {
  user: AdminUser;
  perDay: { day: string; scans: number }[];
}

export const get = <T>(path: string) => api<T>(path);

export interface AdminReport {
  id: string;
  reason: "spam" | "kasar" | "salah_info" | "lainnya";
  note: string | null;
  createdAt: string | number;
  resolvedAt: string | number | null;
  postId: string | null;
  commentId: string | null;
  postKind: "makan" | "latihan" | "berat" | "cerita" | null;
  postTitle: string | null;
  postPhotoId: string | null;
  postPhotosJson: string | null;
  postCaption: string | null;
  postVisibility: "publik" | "grup" | null;
  postAuthorName: string | null;
  postAuthorHandle: string | null;
  commentBody: string | null;
  commentAuthorName: string | null;
  commentAuthorHandle: string | null;
  reporterName: string;
  reporterEmail: string;
}

/** A server-paged list: the rows live under `K` (users, orders, ...) next to the totals. */
export type Paged<K extends string, T> = Record<K, T[]> & {
  total: number;
  page: number;
  pageSize: number;
};

export type PagedReports = Paged<"reports", AdminReport>;

export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
export const post = <T>(path: string) => api<T>(path, { method: "POST" });

export type PagedUsers = Paged<"users", AdminUser>;
export type PagedOrders = Paged<"orders", AdminOrder>;
