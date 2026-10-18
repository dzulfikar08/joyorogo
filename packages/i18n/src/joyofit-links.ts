/**
 * Where JoyoRogo sends people to train. Strength logging moved to JoyoFit (the logger, routines and history live there);
 * JoyoRogo keeps old logs read-only and the quick calorie entry. One place for every link so a Play Store listing can replace
 * the tester opt-in page later by changing `JOYOFIT_ANDROID_URL` only.
 */

/**
 * Opens the installed JoyoFit on its strength home (an expo-router file route, `src/app/strength/index.tsx` in watch-fit).
 * The target rides in a query, not as the URL host (`joyofit://strength`): a JoyoFit bundle that has no `/strength` route yet
 * (an install that has not applied its over-the-air update) answers `joyofit://strength` with expo-router's "Unmatched Route"
 * page, and an open that succeeds never falls through to the next link. `joyofit://?open=strength` reaches such a bundle as the
 * home screen with an ignored parameter, and a current bundle's `+native-intent.ts` turns it into `/strength`.
 */
export const JOYOFIT_STRENGTH_LINK = "joyofit://?open=strength";

/** Opens the installed JoyoFit, any build (the fallback when the strength route may be missing). */
export const JOYOFIT_APP_LINK = "joyofit://";

/** Product site: what JoyoFit is, and the install links for both platforms. */
export const JOYOFIT_SITE_URL = "https://fit.joyorogo.com";

/** Android install: the closed-test opt-in page until JoyoFit has a public Play listing. */
export const JOYOFIT_ANDROID_URL = "https://play.google.com/apps/testing/com.joyodigitama.joyofit";

/** iPhone install: the TestFlight invitation (same link as fit.joyorogo.com). */
export const JOYOFIT_IOS_URL = "https://testflight.apple.com/join/GXzrQ8GJ";
