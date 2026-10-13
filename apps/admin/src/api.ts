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

const dtf = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const df = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });

export function fmtDateTime(x: number | string | null | undefined): string {
  const d = toDate(x);
  return d ? dtf.format(d) : "—";
}

export function fmtDate(x: number | string | null | undefined): string {
  const d = toDate(x);
  return d ? df.format(d) : "—";
}

export function fmtIdr(n: number | null | undefined): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);
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
  tier: "free" | "founder";
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

export interface AdminSession {
  createdAt: string | number;
  updatedAt: string | number;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface UserDetail {
  user: AdminUser;
  calls: AiCall[];
  perDay: { day: string; scans: number }[];
  foods: FoodLog[];
  orders: AdminOrder[];
  sessions: AdminSession[];
}

export const get = <T>(path: string) => api<T>(path);
