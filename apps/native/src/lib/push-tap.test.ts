import { describe, expect, test } from "bun:test";

import { routeForNotificationData } from "./push-tap";

const data = (kind: string, link: unknown) => ({ v: 1, kind, link, url: "/", app: "joyorogo" });

describe("routeForNotificationData", () => {
  test("post opens the thread, with or without a comment", () => {
    expect(routeForNotificationData(data("kudos", { t: "post", postId: "p1" }))).toBe("/feed/p1");
    expect(routeForNotificationData(data("comment", { t: "post", postId: "p1", commentId: "c9" }))).toBe(
      "/feed/p1",
    );
  });

  test("profile, feed, inbox and group", () => {
    expect(routeForNotificationData(data("follow", { t: "profile", handle: "rina" }))).toBe("/u/rina");
    expect(routeForNotificationData(data("kudos", { t: "feed" }))).toBe("/feed/notifikasi");
    expect(routeForNotificationData(data("poke", { t: "inbox" }))).toBe("/inbox");
    expect(routeForNotificationData(data("member_join", { t: "group", groupId: "g1" }))).toBe("/grup/g1");
  });

  test("challenge, makan, berat, rekap, rencana, settings", () => {
    expect(routeForNotificationData(data("challenge_new", { t: "challenge", groupId: "g1", challengeId: "c1" }))).toBe(
      "/grup/g1/tantangan/c1",
    );
    expect(routeForNotificationData(data("meal_noon", { t: "makan" }))).toBe("/(tabs)/makan");
    expect(routeForNotificationData(data("weigh", { t: "berat" }))).toBe("/berat");
    expect(routeForNotificationData(data("recap", { t: "rekap" }))).toBe("/rekap");
    expect(routeForNotificationData(data("plan", { t: "rencana" }))).toBe("/rencana-makan");
    expect(routeForNotificationData(data("test", { t: "settings" }))).toBe("/profil/notifikasi");
  });

  test("anything else is null", () => {
    expect(routeForNotificationData(undefined)).toBeNull();
    expect(routeForNotificationData(null)).toBeNull();
    expect(routeForNotificationData("x")).toBeNull();
    expect(routeForNotificationData({ app: "reminder", kind: "meals" })).toBeNull();
    expect(routeForNotificationData({ v: 2, kind: "x", link: { t: "makan" } })).toBeNull();
    expect(routeForNotificationData(data("x", { t: "nope" }))).toBeNull();
    expect(routeForNotificationData(data("x", { t: "post" }))).toBeNull();
  });
});
