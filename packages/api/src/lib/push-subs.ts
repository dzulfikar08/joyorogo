import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { pushSubscription } from "@joyorogo/db/schema/plans";
import { pushDevice } from "@joyorogo/db/schema/push";

import { D1_MAX_PARAMS, chunk } from "./d1";

// Where a person can be reached: browsers (Web Push endpoints) and phones (Expo tokens). Shared by the `push` router and
// the older `fasting.subscribePush` procedures.

/** Phones kept per account and app; a token that Expo rotated leaves a dead one behind until a send finds it. */
export const MAX_DEVICES_PER_APP = 5;

export async function saveWebSubscription(
  db: Database,
  userId: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  await db
    .insert(pushSubscription)
    .values({
      id: crypto.randomUUID(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
}

export async function removeWebSubscription(db: Database, userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
}

/** Upserts a phone's token for `userId` (a token that moves to another account leaves the old one). */
export async function saveDevice(
  db: Database,
  userId: string,
  input: { app: "joyorogo" | "joyofit"; platform: "android" | "ios"; expoToken: string; locale?: string | undefined },
): Promise<void> {
  const now = new Date();
  await db
    .insert(pushDevice)
    .values({
      id: crypto.randomUUID(),
      userId,
      app: input.app,
      platform: input.platform,
      expoToken: input.expoToken,
      locale: input.locale ?? null,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushDevice.expoToken,
      set: { userId, app: input.app, platform: input.platform, locale: input.locale ?? null, lastSeenAt: now },
    });
  const mine = await db
    .select({ id: pushDevice.id })
    .from(pushDevice)
    .where(and(eq(pushDevice.userId, userId), eq(pushDevice.app, input.app)))
    .orderBy(desc(pushDevice.lastSeenAt));
  const extra = mine.slice(MAX_DEVICES_PER_APP).map((row) => row.id);
  for (const ids of chunk(extra, D1_MAX_PARAMS)) await db.delete(pushDevice).where(inArray(pushDevice.id, ids));
}

export async function removeDevice(db: Database, userId: string, expoToken: string): Promise<void> {
  await db.delete(pushDevice).where(and(eq(pushDevice.userId, userId), eq(pushDevice.expoToken, expoToken)));
}
