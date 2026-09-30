import { router } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { daysUntil } from '../../lib/dates';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { Button, ItemRow } from '../../lib/ui';

export default function Today() {
  const t = useTheme();
  const { items, ready } = useStore();
  const open = items.filter((i) => !i.done);
  const urgent = open.filter((i) => i.deadline && daysUntil(i.deadline) <= 3).length;

  if (!ready) return null;
  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      data={items}
      keyExtractor={(i) => i.id}
      ListHeaderComponent={
        open.length ? (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: t.text, fontSize: 28, fontWeight: '800' }}>{urgent ? `${urgent} ${urgent === 1 ? 'ding' : 'dingen'} voor deze week` : 'Je hebt alles onder controle'}</Text>
            <Text style={{ color: t.muted, marginTop: 4 }}>{open.length} open · gesorteerd op deadline</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => <ItemRow item={item} onPress={() => router.push(`/item/${item.id}`)} />}
      ListEmptyComponent={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 }}>
          <Text style={{ fontSize: 56 }}>📬</Text>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>Geen post meer stressen</Text>
          <Text style={{ color: t.muted, textAlign: 'center', fontSize: 16 }}>Fotografeer een brief, factuur of screenshot. Briefje legt het uit in gewone taal, zegt wat je moet doen en herinnert je aan de deadline.</Text>
          <Button title="Scan je eerste brief" onPress={() => router.push('/scan')} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        </View>
      }
    />
  );
}
