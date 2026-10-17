import { getPermissionsAsync, requestPermissionsAsync } from "expo-media-library";
import { Linking, Platform } from "react-native";
import Share, { Social } from "react-native-share";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../../src/env";
import { shareUrl } from "../../src/lib/share-links";
import type { StorySpec, StoryTemplate } from "./story-card";
import { challengeShareText } from "@joyorogo/api/lib/challenge";
import { fmtNumber, i18n } from "@joyorogo/i18n";

/**
 * Single place that knows how the story image leaves the app: Instagram,
 * clipboard, gallery, system share sheet.
 *
 * Instagram has two paths. With a Facebook App ID (EXPO_PUBLIC_FB_APP_ID) the
 * com.instagram.share.ADD_TO_STORY intent / instagram-stories:// URL opens the
 * Story composer directly, and the transparent "sticker" template is passed as
 * stickerImage so it lands as an overlay on the user's own camera/photo, while
 * photo/brand render as the full-bleed backgroundImage. Without an ID that
 * direct path is not allowed, so the PNG goes to the Instagram app through
 * react-native-share's Instagram target: on Android Instagram's own chooser
 * (Feed or Your Story), on iOS the image is saved to the library and opened in
 * Instagram's composer. Any failure there falls back to the system sheet.
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

/**
 * Caption that travels with the story PNG: casual copy per card kind plus a
 * tracked link back to the site. Mirror of defaultShareText on web.
 */
export function storyShareText(story: StorySpec): string {
  return `${storyShareBody(story)}\n${shareUrl("/", story.kind)}`;
}

function storyShareBody(story: StorySpec): string {
  if (story.kind === "meal") {
    return i18n.t("makan:story.card.share.meal", {
      name: story.name,
      kcal: fmtNumber(Math.round(story.kcal), 1),
    });
  }
  if (story.kind === "workout") {
    return i18n.t("makan:story.card.share.workout", { name: story.name });
  }
  if (story.kind === "recap") {
    return i18n.t("makan:story.card.share.recap", {
      name: story.name,
      on: story.daysOnTarget,
      logged: story.loggedDays,
      avg: fmtNumber(story.avgKcal, 1),
    });
  }
  if (story.kind === "challenge") {
    return challengeShareText(story);
  }
  const lost = story.weightLostKg ?? 0;
  return lost > 0
    ? i18n.t("makan:story.card.share.lost", { kg: fmtNumber(lost, 1) })
    : i18n.t("makan:story.card.share.progress");
}

/** Whether the Instagram app is installed (hidden in the sheet when it is not). */
export async function instagramInstalled(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      return (await Share.isPackageInstalled("com.instagram.android")).isInstalled;
    }
    // iOS: "instagram" is declared in LSApplicationQueriesSchemes (react-native-share plugin in app.json).
    return Platform.OS === "ios" && (await Linking.canOpenURL("instagram://"));
  } catch {
    return false;
  }
}

/** Hands a captured story PNG (file:// URI from view-shot) to the system share sheet. */
export async function shareImageSystem(fileUri: string, story: StorySpec): Promise<void> {
  // Instagram's composer takes no text; the system sheet carries the caption
  // (WhatsApp and most chat apps show it under the image).
  await Share.open({
    url: fileUri,
    type: "image/png",
    message: storyShareText(story),
    failOnCancel: false,
  });
}

/**
 * Sends the story PNG to Instagram. With a Facebook App ID it opens the Story
 * composer directly (sticker template as an overlay, the others as background);
 * without one it uses the plain Instagram target, and anything that goes wrong
 * there lands the user in the system share sheet instead of an error.
 */
export async function shareToInstagram(
  fileUri: string,
  template: StoryTemplate,
  appId: string | null,
  story: StorySpec,
): Promise<void> {
  try {
    if (appId) {
      await Share.shareSingle({
        social: Social.InstagramStories,
        appId,
        ...(template === "sticker" ? { stickerImage: fileUri } : { backgroundImage: fileUri }),
      });
    } else {
      await Share.shareSingle({ social: Social.Instagram, url: fileUri, type: "image/png" });
    }
  } catch (error) {
    if (isShareCancel(error)) throw error;
    await shareImageSystem(fileUri, story);
  }
}

/**
 * "add": write-only access, enough for saving to the gallery. "full": read and
 * write, which react-native-share's iOS Instagram target needs (it saves the
 * image to the library and opens it by asset id).
 */
export type PhotoAccessLevel = "add" | "full";

/** "ask": the system dialog has not been shown yet; "blocked": the user said no. */
export type PhotoAccess = "granted" | "ask" | "blocked";

/** Android 13+ MediaStore writes need no permission, and there is no write-only one to ask for. */
function photoPermissionApplies(): boolean {
  return Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) < 33);
}

export async function getPhotoAccess(level: PhotoAccessLevel): Promise<PhotoAccess> {
  if (!photoPermissionApplies()) return "granted";
  const response = await getPermissionsAsync(level === "add");
  if (response.granted) return "granted";
  return response.canAskAgain ? "ask" : "blocked";
}

/** Triggers the system dialog. Call only after the styled pre-prompt. */
export async function requestPhotoAccess(level: PhotoAccessLevel): Promise<boolean> {
  if (!photoPermissionApplies()) return true;
  return (await requestPermissionsAsync(level === "add")).granted;
}
