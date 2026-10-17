import { compareVersionCodes, downloadPercent } from "@/src/lib/update-policy";
import type {
  PlayUpdateCheck,
  PlayUpdateEvent,
  PlayUpdates,
} from "@/src/lib/play-update-types";

type Sp = typeof import("sp-react-native-in-app-updates");
type DeviceInfo = typeof import("react-native-device-info");

type Native = { sp: Sp; inApp: InstanceType<Sp["default"]>; deviceInfo: DeviceInfo };

let native: Native | null | undefined;

/**
 * Both libraries throw at import when their native half is missing (a dev
 * client built before they were added, Expo Go). Loading lazily keeps that
 * from crashing app start: the update prompt just stays off.
 */
function load(): Native | null {
  if (native !== undefined) return native;
  try {
    const sp: Sp = require("sp-react-native-in-app-updates");
    const deviceInfo: DeviceInfo = require("react-native-device-info");
    native = { sp, inApp: new sp.default(false), deviceInfo };
  } catch {
    native = null;
  }
  return native;
}

export const playUpdates: PlayUpdates = {
  async installer() {
    const lib = load();
    if (!lib) return null;
    try {
      return await lib.deviceInfo.getInstallerPackageName();
    } catch {
      return null;
    }
  },

  async check(installedVersionCode: number): Promise<PlayUpdateCheck> {
    const lib = load();
    if (!lib) return { state: "none" };
    const res = (await lib.inApp.checkNeedsUpdate({
      curVersion: String(installedVersionCode),
      customVersionComparator: compareVersionCodes,
    })) as import("sp-react-native-in-app-updates").AndroidNeedsUpdateResponse;
    const { updateAvailability, isFlexibleUpdateAllowed, versionCode, totalBytes } = res.other;
    if (updateAvailability === lib.sp.IAUAvailabilityStatus.DEVELOPER_TRIGGERED) {
      return { state: "pending" };
    }
    if (res.shouldUpdate && isFlexibleUpdateAllowed) {
      return { state: "available", versionCode, totalBytes: totalBytes ?? null };
    }
    return { state: "none" };
  },

  async startFlexible() {
    const lib = load();
    if (!lib) throw new Error("Play In-App Updates is not available in this build.");
    await lib.inApp.startUpdate({ updateType: lib.sp.IAUUpdateKind.FLEXIBLE });
  },

  restart() {
    load()?.inApp.installUpdate();
  },

  subscribe(listener: (event: PlayUpdateEvent) => void) {
    const lib = load();
    if (!lib) return () => {};
    const { IAUInstallStatus } = lib.sp;

    const onStatus = ({
      status,
      bytesDownloaded,
      totalBytesToDownload,
    }: {
      status: number;
      bytesDownloaded: number;
      totalBytesToDownload: number;
    }) => {
      if (status === IAUInstallStatus.DOWNLOADING || status === IAUInstallStatus.PENDING) {
        listener({ type: "downloading", percent: downloadPercent(bytesDownloaded, totalBytesToDownload) });
      } else if (status === IAUInstallStatus.DOWNLOADED) {
        listener({ type: "downloaded" });
      } else if (status === IAUInstallStatus.FAILED || status === IAUInstallStatus.CANCELED) {
        listener({ type: "failed" });
      }
    };

    // The native side emits the activity result as a string: INSTALLED when the
    // user accepted Play's dialog, CANCELED when they declined it.
    const onChoice = (result: unknown) => {
      if (Number(result) === IAUInstallStatus.CANCELED) listener({ type: "declined" });
    };

    lib.inApp.addStatusUpdateListener(onStatus);
    lib.inApp.addIntentSelectionListener(onChoice);
    return () => {
      lib.inApp.removeStatusUpdateListener(onStatus);
      lib.inApp.removeIntentSelectionListener(onChoice);
    };
  },
};
