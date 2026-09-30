import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? '';
export const RC_IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS ?? extra.revenueCatIos ?? '';
export const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID ?? extra.revenueCatAndroid ?? '';
export const PRIVACY_URL = 'https://briefje.example/privacy';
export const TERMS_URL = 'https://briefje.example/voorwaarden';
