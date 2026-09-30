import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Item } from './types';

const ITEMS_KEY = 'briefje.items.v1';
const SCANS_KEY = 'briefje.scans.v1';

export async function loadItems(): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(ITEMS_KEY);
    return raw ? (JSON.parse(raw) as Item[]) : [];
  } catch {
    return [];
  }
}

export async function saveItems(items: Item[]): Promise<void> {
  await AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export async function loadScanTimes(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(SCANS_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export async function recordScan(): Promise<void> {
  const times = await loadScanTimes();
  const cutoff = Date.now() - 14 * 86_400_000;
  await AsyncStorage.setItem(SCANS_KEY, JSON.stringify([...times.filter((t) => t > cutoff), Date.now()]));
}

export async function wipeAll(): Promise<void> {
  await AsyncStorage.removeMany([ITEMS_KEY, SCANS_KEY]);
}
