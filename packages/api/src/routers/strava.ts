import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { exerciseLog } from "@joyorogo/db/schema/fitness";
import { dayOfMs } from "@joyorogo/i18n";
import type { DayZone, Locale } from "@joyorogo/i18n";

import type { Context } from "../context";

import { protectedProcedure } from "../index";
import { serverT } from "../lib/messages";
import { estimateKcal, metForStravaType } from "../lib/met";
import { stravaRetentionCutoff } from "../lib/strava-retention";
import { userZone } from "../lib/user-zone";
import { weightLookup } from "../lib/weight-at";
import {
  StravaGrantError,
  deleteImportedActivities,
  disconnectProduct,
  exchangeCode,
  freshAccessToken,
  grantStatus,
  isJoyofitUpload,
  stravaConfigured,
} from "../lib/strava-grant";

// protectedProcedure narrows session to non-null; helpers share that shape.
type AuthedContext = Context & { session: NonNullable<Context["session"]> };

const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities?per_page=30";

// Calendar day of an ISO instant in the user's zone — same rule as jakartaToday.
function localDate(iso: string, zone: DayZone): string {
  return dayOfMs(new Date(iso).getTime(), zone);
}

type StravaActivity = {
  id: number;
  type?: string;
  name?: string;
  start_date: string;
  moving_time?: number;
  calories?: number;
  // What the uploader gave Strava; JoyoFit's files start with `joyofit-`.
  external_id?: string;
};

function requireStravaConfig(context: Context): void {
  if (!stravaConfigured(context.env)) {
    throw new ORPCError("NOT_FOUND", {
      message: serverT(context.locale, "olahraga")("server.strava.notConfigured"),
    });
  }
}

/** Strava failures as the user should read them: only a refused grant may tell them to reconnect. */
function toOrpcError(error: unknown, locale: Locale): ORPCError<string, unknown> {
  const t = serverT(locale, "olahraga");
  if (error instanceof StravaGrantError) {
    if (error.failure === "rejected") return new ORPCError("UNAUTHORIZED", { message: t("server.strava.rejected") });
    if (error.failure === "scope_missing") {
      return new ORPCError("BAD_REQUEST", {
        message: t("server.strava.scopeMissing"),
      });
    }
  }
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.strava.retry"), cause: error });
}

async function getValidToken(context: AuthedContext): Promise<string> {
  let token;
  try {
    token = await freshAccessToken(context.db, context.env, context.session.user.id, "rogo");
  } catch (error) {
    throw toOrpcError(error, context.locale);
  }
  if (!token) {
    throw new ORPCError("NOT_FOUND", {
      message: serverT(context.locale, "olahraga")("server.strava.connectFirst"),
    });
  }
  return token.accessToken;
}

export const stravaRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const configured = stravaConfigured(context.env);
    const status = await grantStatus(context.db, userId, "rogo");
    // Nothing imported from Strava outlives the connection (Strava API policy), including when the
    // grant ended elsewhere (deauthorized on strava.com, refused refresh token).
    if (!status.connected) await deleteImportedActivities(context.db, userId);
    return {
      configured,
      connected: status.connected,
      athleteId: status.athleteId,
    };
  }),

  authorizeUrl: protectedProcedure
    .input(z.object({ redirectUri: z.string().url() }))
    .handler(async ({ context, input }) => {
      requireStravaConfig(context);
      const { requestedScope: scope } = await grantStatus(context.db, context.session.user.id, "rogo");
      const url = new URL("https://www.strava.com/oauth/authorize");
      url.searchParams.set("client_id", context.env.STRAVA_CLIENT_ID ?? "");
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      // JoyoRogo's own scopes plus whatever is already granted, so connecting here never narrows a
      // grant JoyoFit uploads with (docs/strava.md).
      url.searchParams.set("scope", scope);
      url.searchParams.set("approval_prompt", "auto");
      return { url: url.toString() };
    }),

  exchangeCode: protectedProcedure
    .input(z.object({ code: z.string().min(1), redirectUri: z.string().url() }))
    .handler(async ({ context, input }) => {
      requireStravaConfig(context);
      try {
        const { athleteId } = await exchangeCode(context.db, context.env, {
          userId: context.session.user.id,
          product: "rogo",
          code: input.code,
        });
        return { connected: true, athleteId };
      } catch (error) {
        throw toOrpcError(error, context.locale);
      }
    }),

  // Strava API policy notes for imported rows (exercise_log.source = 'strava'):
  // owner-only display (excluded from groups, challenges, feed and shares), never
  // sent to AI, not used in adaptive-plan analytics. Policy 6.2 caps the cache at
  // 7 days: lib/strava-retention deletes older rows (cron), and sync below never
  // imports an activity that is already past that window.
  sync: protectedProcedure.handler(async ({ context }) => {
    const zone = await userZone(context);
    const accessToken = await getValidToken(context);
    const res = await fetch(STRAVA_ACTIVITIES_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      throw new ORPCError("UNAUTHORIZED", {
        message: serverT(context.locale, "olahraga")("server.strava.expired"),
      });
    }
    if (!res.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: serverT(context.locale, "olahraga")("server.strava.retry"),
      });
    }
    const activities = (await res.json()) as StravaActivity[];
    // A workout JoyoFit uploaded reaches the diary through Health Connect / Apple Health
    // (source health_connect / apple_health); importing it from Strava too would count it twice.
    // An activity already past the 7-day window (policy 6.2) is not kept at all.
    const cutoff = stravaRetentionCutoff();
    const imports = activities.filter(
      (activity) => !isJoyofitUpload(activity.external_id) && localDate(activity.start_date, zone) > cutoff,
    );

    const weightAt = await weightLookup(context.db, context.session.user.id);

    const statements = imports.map((activity) => {
      const date = localDate(activity.start_date, zone);
      const durationMin = (activity.moving_time ?? 0) / 60;
      const kcal =
        activity.calories && activity.calories > 0
          ? Math.round(activity.calories)
          : estimateKcal(metForStravaType(activity.type ?? ""), weightAt(date), durationMin);
      return context.db
        .insert(exerciseLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date,
          type: activity.type ?? null,
          name: activity.name ?? "Aktivitas Strava",
          durationMin,
          kcal,
          source: "strava",
          externalId: String(activity.id),
        })
        .onConflictDoNothing({
          target: [exerciseLog.userId, exerciseLog.source, exerciseLog.externalId],
        })
        .returning({ id: exerciseLog.id });
    });
    let imported = 0;
    if (statements.length > 0) {
      // The guard guarantees ≥1 statement; drizzle's tuple type can't see it.
      const results = await context.db.batch(
        statements as [(typeof statements)[number], ...(typeof statements)[number][]],
      );
      imported = results.filter((rows) => rows.length > 0).length;
    }
    return { imported, skipped: activities.length - imported };
  }),

  // Strava API policy: on disconnect the imported Strava activities go with the
  // connection. The grant itself is revoked at Strava only when JoyoFit is not
  // using it either (lib/strava-grant disconnectProduct).
  disconnect: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await disconnectProduct(context.db, context.env, userId, "rogo");
    await deleteImportedActivities(context.db, userId);
    return { connected: false };
  }),
};
