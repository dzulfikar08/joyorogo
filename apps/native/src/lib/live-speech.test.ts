import { describe, expect, test } from "bun:test";

import {
  applyResult,
  captionTail,
  commitInterim,
  correctionText,
  EMPTY_LIVE_TEXT,
  hasInstalledLocale,
  isAvailabilityError,
  liveTranscript,
  speechLang,
} from "./live-speech";

describe("speechLang", () => {
  test("maps app locales to recognizer tags", () => {
    expect(speechLang("id")).toBe("id-ID");
    expect(speechLang("en")).toBe("en-US");
    expect(speechLang("ms")).toBe("ms-MY");
    expect(speechLang("fr")).toBe("id-ID");
  });
});

describe("live transcript", () => {
  test("interim results replace each other", () => {
    let s = applyResult(EMPTY_LIVE_TEXT, { transcript: "nasi", isFinal: false });
    s = applyResult(s, { transcript: "nasinya setengah", isFinal: false });
    expect(liveTranscript(s)).toBe("nasinya setengah");
  });

  test("final segments pile up and the live segment follows", () => {
    let s = applyResult(EMPTY_LIVE_TEXT, { transcript: "nasinya setengah", isFinal: true });
    s = applyResult(s, { transcript: "itu mangga", isFinal: false });
    expect(liveTranscript(s)).toBe("nasinya setengah itu mangga");
    s = applyResult(s, { transcript: "itu mangga bukan jeruk", isFinal: true });
    expect(s.interim).toBe("");
    expect(liveTranscript(s)).toBe("nasinya setengah itu mangga bukan jeruk");
  });

  test("a single iOS-style final carries the whole utterance", () => {
    let s = applyResult(EMPTY_LIVE_TEXT, { transcript: "nasi", isFinal: false });
    s = applyResult(s, { transcript: "nasi setengah", isFinal: true });
    expect(liveTranscript(s)).toBe("nasi setengah");
  });

  test("commitInterim keeps the unfinished segment", () => {
    const s = commitInterim({ committed: "a", interim: "b" });
    expect(s).toEqual({ committed: "a b", interim: "" });
  });
});

describe("correctionText", () => {
  test("rejects empty and one-character takes", () => {
    expect(correctionText("")).toBeNull();
    expect(correctionText("   ")).toBeNull();
    expect(correctionText(" a ")).toBeNull();
  });

  test("collapses whitespace and trims to 300 characters", () => {
    expect(correctionText("  nasi   setengah ")).toBe("nasi setengah");
    const long = correctionText("ab ".repeat(200));
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(300);
    expect(long!.endsWith(" ")).toBe(false);
  });
});

describe("captionTail", () => {
  test("short text is untouched", () => {
    expect(captionTail("nasi setengah")).toBe("nasi setengah");
  });

  test("long text keeps the latest whole words", () => {
    const text = Array.from({ length: 60 }, (_, i) => `kata${i}`).join(" ");
    const tail = captionTail(text);
    expect(tail.startsWith("…")).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(121);
    expect(tail.endsWith("kata59")).toBe(true);
    expect(tail.slice(1).startsWith("kata")).toBe(true);
  });
});

describe("availability", () => {
  test("only environment failures switch to recording", () => {
    for (const code of ["not-allowed", "service-not-allowed", "language-not-supported", "network"]) {
      expect(isAvailabilityError(code)).toBe(true);
    }
    for (const code of ["no-speech", "speech-timeout", "aborted", "audio-capture", "busy"]) {
      expect(isAvailabilityError(code)).toBe(false);
    }
  });

  test("installed locale match ignores case and separator", () => {
    expect(hasInstalledLocale(["en-US", "id_ID"], "id-ID")).toBe(true);
    expect(hasInstalledLocale(["en-US"], "id-ID")).toBe(false);
  });
});
