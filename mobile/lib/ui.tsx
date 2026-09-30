import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { deadlineLabel, daysUntil } from './dates';
import { useTheme } from './theme';
import type { Item, Urgency } from './types';

export function Button({ title, onPress, variant = 'primary', disabled, style }: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : 'transparent';
  const color = variant === 'primary' ? t.onPrimary : variant === 'danger' ? t.danger : t.primary;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: variant === 'primary' ? bg : t.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      <Text style={[s.btnText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function urgencyColor(u: Urgency, t: ReturnType<typeof useTheme>) {
  return u === 'high' ? t.danger : u === 'medium' ? t.warn : t.ok;
}

export function ItemRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const t = useTheme();
  const overdue = !item.done && item.deadline != null && daysUntil(item.deadline) < 0;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[s.card, { backgroundColor: t.card, borderColor: t.border, opacity: item.done ? 0.55 : 1 }]}>
      <View style={[s.dot, { backgroundColor: urgencyColor(item.urgency, t) }]} />
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: t.text }, item.done && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{item.title}</Text>
        <Text style={{ color: t.muted, marginTop: 2 }} numberOfLines={1}>{[item.sender, item.category].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: overdue ? t.danger : t.text, fontWeight: '600' }}>{item.done ? 'Klaar' : deadlineLabel(item.deadline)}</Text>
        {item.amount ? <Text style={{ color: t.muted, marginTop: 2 }}>{item.amount}</Text> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 50, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnText: { fontSize: 16, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontSize: 16, fontWeight: '700' },
});
