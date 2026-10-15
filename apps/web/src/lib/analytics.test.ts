import { describe, expect, test } from "bun:test";

import { scrubInviteCodes } from "./analytics";
import { shareUrl } from "./share-links";

describe("scrubInviteCodes", () => {
  test("cuts the code from paths, encoded redirects, and share URLs", () => {
    const batch = JSON.stringify([
      { t: "c", p: "/gabung/KURUNG23" },
      { t: "pv", p: "/login?redirect=%2Fgabung%2FKURUNG23", r: "https://joyorogo.com/gabung/KURUNG23?utm_source=app-share" },
    ]);
    const out = scrubInviteCodes(batch);
    expect(out).not.toContain("KURUNG23");
    expect(out).toContain('"/gabung"');
    expect(out).toContain("redirect=%2Fgabung");
    expect(out).toContain("/gabung?utm_source=app-share");
  });

  test("leaves other paths alone", () => {
    const batch = JSON.stringify([{ p: "/blog/kalori-gorengan/" }, { p: "/u/budi" }, { p: "/gabungan" }]);
    expect(scrubInviteCodes(batch)).toBe(batch);
  });
});

describe("shareUrl", () => {
  test("adds source, medium, campaign", () => {
    expect(shareUrl("/gabung/ABCD2345", "invite")).toBe(
      "https://joyorogo.com/gabung/ABCD2345?utm_source=app-share&utm_medium=invite&utm_campaign=share-web",
    );
    expect(shareUrl("/", "meal")).toBe(
      "https://joyorogo.com/?utm_source=app-share&utm_medium=meal&utm_campaign=share-web",
    );
  });
});
