import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { analyzeImage, ApiError } from './api';
import { cancelReminder, scheduleReminder } from './notifications';
import { initPurchases, isPro } from './purchases';
import { FREE_SCANS_PER_WEEK, scansLeft } from './quota';
import { sortItems } from './sort';
import { loadItems, loadScanTimes, recordScan, saveItems, wipeAll } from './storage';
import type { Item } from './types';

interface Store {
  ready: boolean;
  items: Item[];
  pro: boolean;
  freeLeft: number;
  /** Returns the new item id, or 'paywall' when the free quota is used up. */
  scan: (base64: string, mediaType: string) => Promise<string | 'paywall'>;
  toggleDone: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refreshPro: () => Promise<void>;
  wipe: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

async function getInstallId(): Promise<string> {
  let id = await SecureStore.getItemAsync('briefje.install').catch(() => null);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync('briefje.install', id).catch(() => {});
  }
  return id;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [scanTimes, setScanTimes] = useState<number[]>([]);
  const [pro, setPro] = useState(false);
  const [installId, setInstallId] = useState('');

  useEffect(() => {
    (async () => {
      const id = await getInstallId();
      setInstallId(id);
      initPurchases(id);
      const [loaded, times, p] = await Promise.all([loadItems(), loadScanTimes(), isPro()]);
      setItems(loaded);
      setScanTimes(times);
      setPro(p);
      setReady(true);
    })();
  }, []);

  const commit = useCallback(async (next: Item[]) => {
    setItems(next);
    await saveItems(next);
  }, []);

  const freeLeft = pro ? Infinity : scansLeft(scanTimes);

  const scan: Store['scan'] = useCallback(
    async (base64, mediaType) => {
      if (!pro && scansLeft(scanTimes) <= 0) return 'paywall';
      let analysis;
      try {
        analysis = await analyzeImage(base64, mediaType, installId);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'quota') return 'paywall';
        throw e;
      }
      const item: Item = { ...analysis, id: Crypto.randomUUID(), createdAt: new Date().toISOString(), done: false, notificationId: null };
      item.notificationId = await scheduleReminder(item).catch(() => null);
      await recordScan();
      setScanTimes(await loadScanTimes());
      await commit([item, ...items]);
      return item.id;
    },
    [pro, scanTimes, installId, items, commit],
  );

  const toggleDone: Store['toggleDone'] = useCallback(
    async (id) => {
      const target = items.find((i) => i.id === id);
      if (!target) return;
      const done = !target.done;
      let notificationId = target.notificationId;
      if (done) {
        await cancelReminder(notificationId);
        notificationId = null;
      } else {
        notificationId = await scheduleReminder(target).catch(() => null);
      }
      await commit(items.map((i) => (i.id === id ? { ...i, done, notificationId } : i)));
    },
    [items, commit],
  );

  const remove: Store['remove'] = useCallback(
    async (id) => {
      await cancelReminder(items.find((i) => i.id === id)?.notificationId ?? null);
      await commit(items.filter((i) => i.id !== id));
    },
    [items, commit],
  );

  const wipe = useCallback(async () => {
    await Promise.all(items.map((i) => cancelReminder(i.notificationId)));
    await wipeAll();
    setItems([]);
    setScanTimes([]);
  }, [items]);

  const refreshPro = useCallback(async () => setPro(await isPro()), []);

  const value = useMemo<Store>(
    () => ({ ready, items: sortItems(items), pro, freeLeft: Number.isFinite(freeLeft) ? freeLeft : FREE_SCANS_PER_WEEK, scan, toggleDone, remove, refreshPro, wipe }),
    [ready, items, pro, freeLeft, scan, toggleDone, remove, refreshPro, wipe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
