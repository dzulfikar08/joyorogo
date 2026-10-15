import Constants from "expo-constants";

/**
 * True in the Google Play build (JOYOROGO_DISTRIBUTION=play, see app.config.ts).
 * Play forbids self-updating outside Play and selling digital goods through
 * an external checkout, so those paths are switched off when this is set.
 */
export const IS_PLAY_BUILD = Constants.expoConfig?.extra?.distribution === "play";
