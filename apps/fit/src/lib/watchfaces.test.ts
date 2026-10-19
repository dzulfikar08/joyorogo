import { describe, expect, test } from "bun:test";

import { FitApiError } from "./fit-api-error";
import { MAX_FACE_BYTES, checkFaceFile, downloadName, faceUploadError } from "./watchfaces";

describe("checkFaceFile", () => {
  test("a .hwt of a sensible size may go; the extension is not case sensitive", () => {
    expect(checkFaceFile({ name: "Aurora.hwt", size: 120_000 })).toBeNull();
    expect(checkFaceFile({ name: "AURORA.HWT", size: 1 })).toBeNull();
    expect(checkFaceFile({ name: "x.hwt", size: MAX_FACE_BYTES })).toBeNull();
  });

  test("wrong extension, empty and oversized files are refused before sending", () => {
    expect(checkFaceFile({ name: "face.zip", size: 10 })).toEqual({
      ok: false,
      reason: "extension",
    });
    expect(checkFaceFile({ name: "face.hwt.txt", size: 10 })).toEqual({
      ok: false,
      reason: "extension",
    });
    expect(checkFaceFile({ name: "face.hwt", size: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(checkFaceFile({ name: "face.hwt", size: MAX_FACE_BYTES + 1 })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("faceUploadError", () => {
  const api = (status: number, code = "", body: unknown = null) =>
    faceUploadError(new FitApiError(status, code, body));

  test("the Pro, session, size and library answers", () => {
    expect(api(402, "founder_required")).toEqual({ ok: false, reason: "paywall" });
    expect(api(401, "unauthorized")).toEqual({ ok: false, reason: "unauthorized" });
    expect(api(413, "too_large")).toEqual({ ok: false, reason: "too_large" });
    expect(api(409, "library_full")).toEqual({ ok: false, reason: "library_full" });
    expect(api(400, "empty_body")).toEqual({ ok: false, reason: "empty" });
  });

  test("an invalid file carries the API's reason", () => {
    expect(api(400, "invalid_hwt", { error: "invalid_hwt", reason: "not a zip file" })).toEqual({
      ok: false,
      reason: "invalid_hwt",
      detail: "not a zip file",
    });
    expect(api(400, "invalid_hwt", {})).toEqual({
      ok: false,
      reason: "invalid_hwt",
      detail: undefined,
    });
  });

  test("anything else is the network (nothing came back) or the server (it said no)", () => {
    expect(api(0, "network")).toEqual({ ok: false, reason: "network" });
    expect(faceUploadError(new TypeError("fetch failed"))).toEqual({
      ok: false,
      reason: "network",
    });
    expect(api(502, "fit_api_unreachable")).toEqual({ ok: false, reason: "server" });
    expect(api(500)).toEqual({ ok: false, reason: "server" });
  });
});

describe("downloadName", () => {
  test("keeps the original name and always ends in .hwt", () => {
    expect(downloadName({ filename: "Aurora.hwt", name: "Aurora" })).toBe("Aurora.hwt");
    expect(downloadName({ filename: "", name: "Aurora" })).toBe("Aurora.hwt");
    expect(downloadName({ filename: "face", name: "x" })).toBe("face.hwt");
  });
});
