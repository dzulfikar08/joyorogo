import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type AppleIapProduct = {
  id: string;
  displayName: string;
  displayPrice: string;
  /** Numeric price in the storefront currency (Swift Decimal, e.g. "29000"). */
  price: string;
};

export type AppleUnfinished = {
  signedTransaction: string;
  transactionId: string;
};

export type ApplePurchaseResult =
  | ({ status: "success" } & AppleUnfinished)
  | { status: "cancelled" }
  | { status: "pending" };

type NativeAppleIap = {
  getProduct(productId: string): Promise<AppleIapProduct | null>;
  /** appAccountToken: UUID derived from the user id (see appleAccountToken in components/billing). */
  purchase(productId: string, appAccountToken: string): Promise<ApplePurchaseResult>;
  finish(transactionId: string): Promise<boolean>;
  unfinished(): Promise<AppleUnfinished[]>;
  /** Verified active subscription transactions; `sync` asks the App Store to refresh first (restore). */
  currentEntitlements(sync: boolean): Promise<AppleUnfinished[]>;
  /** Opens Apple's subscription management sheet; false when no window scene is available. */
  showManageSubscriptions(): Promise<boolean>;
};

/**
 * StoreKit 2 bridge; null on Android and web because the native module only
 * ships for Apple platforms. Callers branch on Platform.OS === "ios".
 */
export const appleIap: NativeAppleIap | null =
  Platform.OS === "ios" ? requireOptionalNativeModule<NativeAppleIap>("AppleIap") : null;
