import type { PlayUpdates } from "@/src/lib/play-update-types";

/** iOS and web: Play In-App Updates does not exist. The Android build resolves play-update.android.ts. */
export const playUpdates: PlayUpdates | null = null;
