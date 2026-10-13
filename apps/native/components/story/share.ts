import Share, { Social } from "react-native-share";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../../src/env";

/**
 * Single place that knows how Instagram Stories direct sharing works. The
 * com.instagram.share.ADD_TO_STORY intent needs a Facebook App ID
 * (source_application); without one the story PNG goes through the system
 * share sheet and the user picks Instagram > Story themselves. Set
 * EXPO_PUBLIC_FB_APP_ID to switch to the direct path.
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
 * Shares a local PNG (file:// URI from view-shot) to Instagram Stories when
 * the Facebook App ID is configured, else opens the system share sheet.
 */
export async function shareStoryImage(fileUri: string, appId: string | null): Promise<void> {
  if (appId) {
    await Share.shareSingle({
      social: Social.InstagramStories,
      backgroundImage: fileUri,
      appId,
    });
    return;
  }
  await Share.open({ url: fileUri, type: "image/png", failOnCancel: false });
}
