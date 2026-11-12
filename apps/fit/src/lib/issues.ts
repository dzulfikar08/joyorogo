// The feedback page (/issues): JoyoFit's Atur board (project FIT) as the signed-in account. Every call goes
// `/api/fit/feedback/*` (this API's proxy) -> JoyoFit API `/v1/feedback/*` -> Atur's signed-in API, which the JoyoFit API
// signs per request (joyofit repo docs/feedback.md). Nothing here holds an Atur credential.

import { queryOptions } from "@tanstack/react-query";

import { fitApi } from "./fit-api";

export interface IssueState {
  name: string;
  color: string | null;
  group: string | null;
}

export interface Idea {
  id: string;
  sequence_id: number;
  name: string;
  description: string | null;
  state: (IssueState & { id?: string }) | null;
  votes: number;
  voted: boolean;
  comment_count: number;
  author_name: string | null;
  created_at: string | null;
}

export interface IdeaDetail extends Idea {
  comments: { id: string; body: string | null; created_at: string | null }[];
}

export interface Board {
  board: {
    title: string;
    description: string | null;
    allow_voting: boolean;
    allow_comments: boolean;
  };
  items: Idea[];
}

export interface TicketSummary {
  sequence_id: number;
  project_id: string;
  name: string;
  state: IssueState | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

export interface MineItem {
  id: string;
  sequence_id: number;
  name: string;
  kind: string | null;
  created_at: string | null;
  state_name: string | null;
  state_color: string | null;
}

export interface Reports {
  tickets: TicketSummary[];
  ideas: MineItem[];
  unverified: MineItem[];
}

export interface Ticket {
  sequence_id: number;
  project_id: string;
  name: string;
  description: string | null;
  state: IssueState | null;
  created_at: string | null;
  completed_at: string | null;
  comments: {
    id: string;
    text: string;
    created_at: string | null;
    from: "you" | "team";
    author_name: string | null;
  }[];
}

export interface ChangelogEntry {
  id: string;
  sequence_id: number;
  name: string;
  description: string | null;
  completed_at: string | null;
  votes: number;
}

/** New reports arrive through the widget, which has no callback: lists refresh on focus and every half minute. */
const LIVE = { staleTime: 15_000, refetchInterval: 30_000, refetchOnWindowFocus: true } as const;

export const issuesKeys = {
  all: ["feedback"] as const,
  board: ["feedback", "board"] as const,
  idea: (id: string) => ["feedback", "idea", id] as const,
  reports: ["feedback", "reports"] as const,
  ticket: (seq: number, project?: string) => ["feedback", "ticket", seq, project ?? ""] as const,
  changelog: ["feedback", "changelog"] as const,
};

export const boardQuery = queryOptions({
  queryKey: issuesKeys.board,
  queryFn: () => fitApi<Board>("/feedback/board"),
  ...LIVE,
});

export const ideaQuery = (id: string) =>
  queryOptions({
    queryKey: issuesKeys.idea(id),
    queryFn: () => fitApi<IdeaDetail>(`/feedback/items/${id}`),
  });

export const reportsQuery = queryOptions({
  queryKey: issuesKeys.reports,
  queryFn: () => fitApi<Reports>("/feedback/reports"),
  ...LIVE,
});

export const ticketQuery = (seq: number, project?: string) =>
  queryOptions({
    queryKey: issuesKeys.ticket(seq, project),
    queryFn: () =>
      fitApi<Ticket>(
        `/feedback/tickets/${seq}${project ? `?project=${encodeURIComponent(project)}` : ""}`,
      ),
    refetchInterval: 30_000,
  });

export const changelogQuery = queryOptions({
  queryKey: issuesKeys.changelog,
  queryFn: () => fitApi<{ results: ChangelogEntry[] }>("/feedback/changelog"),
  staleTime: 5 * 60_000,
});

export function vote(id: string) {
  return fitApi<{ voted: boolean; count: number }>(`/feedback/items/${id}/votes`, {
    method: "POST",
  });
}

export function commentOnIdea(id: string, body: string) {
  return fitApi<{ id: string }>(`/feedback/items/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export function replyToTicket(seq: number, body: string, project?: string) {
  return fitApi<{ id: string | null }>(
    `/feedback/tickets/${seq}/comments${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

/** A comment or reply: what Atur accepts (the JoyoFit API checks it too). */
export const MAX_COMMENT_CHARS = 4000;

/** Completed or cancelled work reads as closed; everything else is still open. */
export function isClosed(state: { group: string | null } | null | undefined): boolean {
  return state?.group === "completed" || state?.group === "cancelled";
}
