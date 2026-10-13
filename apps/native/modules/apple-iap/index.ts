import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type AppleIapProduct = {
  id: string;
  displayName: string;
  displayPrice: string;
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
  purchase(productId: string): Promise<ApplePurchaseResult>;
  finish(transactionId: string): Promise<boolean>;
  unfinished(): Promise<AppleUnfinished[]>;
};

/**
 * StoreKit 2 bridge; null on Android and web because the native module only
 * ships for Apple platforms. Callers branch on Platform.OS === "ios".
 */
export const appleIap: NativeAppleIap | null =
  Platform.OS === "ios" ? requireOptionalNativeModule<NativeAppleIap>("AppleIap") : null;
