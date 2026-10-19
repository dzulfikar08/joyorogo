/**
 * Hands a generated file to the browser's download: a Blob URL on a temporary link, revoked a little later (revoking at
 * once can cancel the download in some browsers). Nothing leaves the page.
 */

import type { ExportFile } from "./formats";

const REVOKE_AFTER_MS = 30_000;

export function downloadFile(file: ExportFile): void {
  // The copy gives the Blob its own ArrayBuffer-backed bytes whatever the source view pointed at.
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
