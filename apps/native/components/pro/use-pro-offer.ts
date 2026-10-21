import { useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";

import { useAppConfig, type AppConfig } from "@/components/billing";
import { orpc } from "@/utils/orpc";

/**
 * Whether this phone can sell Pro to this account right now: the server's paywall is on, the platform has a working
 * checkout (Play Billing in the Play build, StoreKit on iOS, the web checkout in the sideload APK: `useAppConfig` already
 * maps that into `billing`), and the account is free. Every Pro entry point outside the paywall asks this first, so none
 * of them can lead to /founder bouncing straight back.
 */
export function useProOffer(): { canSell: boolean; config: AppConfig | undefined } {
  const config = useAppConfig();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const data = config.data;
  const checkout = Platform.OS === "ios" ? data?.appleBilling === true : data?.billing === true;
  const canSell =
    data !== undefined &&
    data.paywall === true &&
    data.freeDailyScans !== null &&
    checkout &&
    profile.data?.tier === "free";
  return { canSell, config: data };
}
