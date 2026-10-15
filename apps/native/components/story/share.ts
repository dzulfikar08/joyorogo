import Share, { Social } from "react-native-share";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../../src/env";
import { shareUrl } from "../../src/lib/share-links";
import type { StorySpec, StoryTemplate } from "./story-card";
import { challengeShareText } from "@joyorogo/api/lib/challenge";

/**
 * Single place that knows how Instagram Stories direct sharing works. The
 * com.instagram.share.ADD_TO_STORY intent needs a Facebook App ID
 * (source_application); without one the story PNG goes through the system
 * share sheet and the user picks Instagram > Story themselves. Set
 * EXPO_PUBLIC_FB_APP_ID to switch to the direct path.
 *
 * For the direct path the transparent "sticker" template is passed as
 * stickerImage (the user composes it over their own story), photo/brand
 * renders as the full-bleed backgroundImage.
 */

/** Facebook App ID for IG Stories, or null when it is not configured. */
export function instagramFbAppId(): string | null {
  const appId = ENV.EXPO_PUBLIC_FB_APP_ID?.trim();
  return appId ? appId : null;
}

/** Android share sheet dismissals surface as errors; they are not failures. */
export function isShareCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|User did not share|does not respond/i.test(message);
}

const idFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/**
 * Caption that travels with the story PNG: casual copy per card kind plus a
 * tracked link back to the site. Mirror of defaultShareText on web.
 */
export function storyShareText(story: StorySpec): string {
  return `${storyShareBody(story)}\n${shareUrl("/", story.kind)}`;
}

function storyShareBody(story: StorySpec): string {
  if (story.kind === "meal") {
    return `${story.name}, ${idFmt.format(Math.round(story.kcal))} kcal. Tahu boleh makan apa hari ini? Cek JoyoRogo.`;
  }
  if (story.kind === "workout") {
    return `Baru selesai latihan: ${story.name}. Catat latihanmu di JoyoRogo.`;
  }
  if (story.kind === "recap") {
    return `Rekapku ${story.name}: ${story.daysOnTarget} dari ${story.loggedDays} hari sesuai target, rata-rata ${idFmt.format(story.avgKcal)} kcal per hari. Catat makanmu di JoyoRogo.`;
  }
  if (story.kind === "challenge") {
    return challengeShareText(story);
  }
  const lost = story.weightLostKg ?? 0;
  return lost > 0
    ? `Sudah turun ${idFmt.format(lost)} kg. Turun berat pakai 3 angka aja di JoyoRogo.`
    : "Turun berat pakai 3 angka aja: makan, bakar, tidur. JoyoRogo.";
}

/**
 * Shares a captured story PNG (file:// URI from view-shot). With a Facebook
 * App ID configured it opens Instagram's story composer directly; the
 * transparent sticker template rides along as stickerImage so it lands as an
 * overlay. Otherwise the system share sheet takes the PNG as-is.
 */
export async function shareStoryImage(
  fileUri: string,
  template: StoryTemplate,
  appId: string | null,
  story: StorySpec,
): Promise<void> {
  if (appId) {
    await Share.shareSingle({
      social: Social.InstagramStories,
      appId,
      ...(template === "sticker" ? { stickerImage: fileUri } : { backgroundImage: fileUri }),
    });
    return;
  }
  // Instagram's composer takes no text; the system sheet carries the caption
  // (WhatsApp and most chat apps show it under the image).
  await Share.open({
    url: fileUri,
    type: "image/png",
    message: storyShareText(story),
    failOnCancel: false,
  });
}
