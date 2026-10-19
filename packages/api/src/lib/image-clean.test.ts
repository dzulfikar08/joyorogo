import { describe, expect, test } from "bun:test";

import { cleanImage, sniffImage, stripJpeg, stripWebp } from "./image-clean";

const bytesOf = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];

const EXIF_GPS = ascii("Exif\0\0GPS-LAT-7.98-LON-112.63");
const XMP = ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>");
const ICC = ascii("ICC_PROFILE\0\x01\x01profile-bytes");

/** SOI, JFIF, EXIF, XMP, ICC, IPTC, comment, frame header, scan with a 0xFF00 stuffed byte, EOI. */
const SCAN = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9];
const jpeg = bytesOf(
  [0xff, 0xd8],
  segment(0xe0, ascii("JFIF\0\x01\x01")),
  segment(0xe1, EXIF_GPS),
  segment(0xe1, XMP),
  segment(0xe2, ICC),
  segment(0xed, ascii("Photoshop 3.0\0IPTC-CAPTION")),
  segment(0xfe, ascii("shot at home")),
  segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
  SCAN,
);

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("jpeg", () => {
  test("drops EXIF, XMP, IPTC and comments; keeps JFIF, ICC, the frame and the scan byte for byte", () => {
    const out = stripJpeg(jpeg)!;
    expect(out).not.toBeNull();
    const s = text(out);
    for (const gone of ["Exif", "GPS-LAT", "xmpmeta", "IPTC-CAPTION", "shot at home"]) expect(s).not.toContain(gone);
    for (const kept of ["JFIF", "ICC_PROFILE"]) expect(s).toContain(kept);
    expect([...out.subarray(out.length - SCAN.length)]).toEqual(SCAN);
    expect(sniffImage(out)).toBe("jpeg");
  });

  test("bytes after the end-of-image marker are cut, and a missing EOI is not an image", () => {
    const payload = ascii("<script>alert(1)</script>");
    const out = stripJpeg(bytesOf(jpeg, payload))!;
    expect(text(out)).not.toContain("script");
    expect([...out.subarray(out.length - 2)]).toEqual([0xff, 0xd9]);
    expect(stripJpeg(jpeg.subarray(0, jpeg.length - 2))).toBeNull();
  });

  test("a second scan (progressive) and its tables survive", () => {
    const second = bytesOf([0xff, 0xd8], segment(0xc2, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]), [0xff, 0xda, 0x00, 0x04, 1, 2, 0x44, 0xff, 0x00, 0xff, 0xc4, 0x00, 0x03, 0x00, 0xff, 0xda, 0x00, 0x04, 1, 2, 0x55, 0xff, 0xd9]);
    const out = stripJpeg(second)!;
    expect([...out]).toEqual([...second]);
  });

  test("a truncated segment is not an image", () => {
    expect(stripJpeg(jpeg.subarray(0, 12))).toBeNull();
  });
});

function chunk(tag: string, payload: number[]) {
  const pad = payload.length & 1 ? [0] : [];
  const size = payload.length;
  return [...ascii(tag), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff, ...payload, ...pad];
}

function webp(flags: number) {
  const vp8x = chunk("VP8X", [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const body = [...ascii("WEBP"), ...vp8x, ...chunk("VP8 ", [1, 2, 3, 4, 5]), ...chunk("EXIF", ascii("Exif\0\0GPS-LAT")), ...chunk("XMP ", ascii("<xmp/>"))];
  const size = body.length;
  return bytesOf(ascii("RIFF"), [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], body);
}

describe("webp", () => {
  test("drops EXIF and XMP, clears their flags and keeps the RIFF size honest", () => {
    const input = webp(0x08 | 0x04 | 0x10);
    const out = stripWebp(input)!;
    expect(out).not.toBeNull();
    const s = text(out);
    expect(s).not.toContain("EXIF");
    expect(s).not.toContain("GPS-LAT");
    expect(s).not.toContain("XMP ");
    expect(s).toContain("VP8 ");
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    // VP8X payload starts at 20: its flag byte keeps ICC/alpha bits only.
    expect(out[20]).toBe(0x10);
  });

  test("a chunk that runs past the file is rejected", () => {
    const input = webp(0);
    expect(stripWebp(input.subarray(0, input.length - 6))).toBeNull();
  });
});

describe("cleanImage", () => {
  test("the declared type has to match the bytes", () => {
    expect(cleanImage(jpeg, "image/jpeg")?.kind).toBe("jpeg");
    expect(cleanImage(jpeg, "image/webp")).toBeNull();
    expect(cleanImage(webp(0), "image/jpeg")).toBeNull();
    expect(cleanImage(new TextEncoder().encode("<svg onload=alert(1)>"), "image/jpeg")).toBeNull();
  });
});
