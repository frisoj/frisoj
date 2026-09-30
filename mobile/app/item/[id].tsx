import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { deadlineLabel } from '../../lib/dates';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { Button, urgencyColor } from '../../lib/ui';

export default function Detail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, toggleDone, remove } = useStore();
  const item = items.find((i) => i.id === id);

  if (!item) return <Text style={{ color: t.text, padding: 20 }}>Niet gevonden.</Text>;

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={{ marginTop: 20 }}>
      <Text style={{ color: t.muted, fontWeight: '700', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Text style={{ color: t.muted }}>{[item.sender, item.category].filter(Boolean).join(' · ')}</Text>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '800', marginTop: 4 }}>{item.title}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <Text style={{ color: urgencyColor(item.urgency, t), fontWeight: '700' }}>● {deadlineLabel(item.deadline)}</Text>
        {item.amount ? <Text style={{ color: t.text, fontWeight: '700' }}>{item.amount}</Text> : null}
      </View>

      <Section label="Wat staat erin">
        <Text style={{ color: t.text, fontSize: 17, lineHeight: 25 }}>{item.summary}</Text>
      </Section>

      {item.actions.length ? (
        <Section label="Wat moet je doen">
          {item.actions.map((a, i) => (
            <Text key={i} style={{ color: t.text, fontSize: 17, lineHeight: 25, marginBottom: 4 }}>{i + 1}. {a}</Text>
          ))}
        </Section>
      ) : null}

      {item.replyDraft ? (
        <Section label="Conceptantwoord">
          <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 14 }}>
            <Text selectable style={{ color: t.text, fontSize: 16, lineHeight: 24 }}>{item.replyDraft}</Text>
          </View>
          <Button title="Delen / kopiëren" variant="ghost" style={{ marginTop: 10 }} onPress={() => Share.share({ message: item.replyDraft! })} />
        </Section>
      ) : null}

      <View style={{ marginTop: 28, gap: 10 }}>
        <Button title={item.done ? 'Weer openen' : '✓  Afgehandeld'} onPress={async () => { await toggleDone(item.id); if (!item.done) router.back(); }} />
        <Button
          title="Verwijderen"
          variant="danger"
          onPress={() => Alert.alert('Verwijderen?', 'Dit kan niet ongedaan worden gemaakt.', [{ text: 'Annuleer', style: 'cancel' }, { text: 'Verwijder', style: 'destructive', onPress: async () => { await remove(item.id); router.back(); } }])}
        />
      </View>
      <Text style={{ color: t.muted, marginTop: 20, fontSize: 12 }}>Briefje is een hulpmiddel en geen juridisch of financieel advies. Controleer belangrijke zaken altijd in het originele document.</Text>
    </ScrollView>
  );
}
