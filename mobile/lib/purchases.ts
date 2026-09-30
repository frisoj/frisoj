import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { RC_ANDROID_KEY, RC_IOS_KEY } from './config';

export const ENTITLEMENT = 'pro';
const key = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
let configured = false;

/** Purchases are only available in a dev/production build with RevenueCat keys, not in Expo Go. */
export function purchasesAvailable() {
  return configured;
}

export function initPurchases(appUserId: string) {
  if (!key || configured) return;
  try {
    Purchases.configure({ apiKey: key, appUserID: appUserId });
    configured = true;
  } catch {
    configured = false;
  }
}

export async function isPro(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active[ENTITLEMENT];
  } catch {
    return false;
  }
}

export async function getPackages(): Promise<PurchasesPackage[]> {
  if (!configured) return [];
  try {
    return (await Purchases.getOfferings()).current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

export async function purchase(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return !!customerInfo.entitlements.active[ENTITLEMENT];
  } catch (e: any) {
    if (e?.userCancelled) return false;
    throw e;
  }
}

export async function restore(): Promise<boolean> {
  if (!configured) return false;
  const info = await Purchases.restorePurchases();
  return !!info.entitlements.active[ENTITLEMENT];
}
