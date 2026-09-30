import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reminderDate } from './reminder-date';
import type { Item } from './types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('deadlines', { name: 'Deadlines', importance: Notifications.AndroidImportance.HIGH });
  }
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function scheduleReminder(item: Pick<Item, 'title' | 'deadline'>): Promise<string | null> {
  if (!item.deadline) return null;
  const when = reminderDate(item.deadline);
  if (!when || !(await ensurePermission())) return null;
  return Notifications.scheduleNotificationAsync({
    content: { title: 'Deadline nadert', body: item.title },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: 'deadlines' },
  });
}

export async function cancelReminder(id: string | null) {
  if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
