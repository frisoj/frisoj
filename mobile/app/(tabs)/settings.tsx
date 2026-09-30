import { router } from 'expo-router';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { PRIVACY_URL, TERMS_URL } from '../../lib/config';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { Button } from '../../lib/ui';

export default function Settings() {
  const t = useTheme();
  const { pro, wipe, items } = useStore();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>{pro ? 'Briefje Pro actief' : 'Gratis abonnement'}</Text>
        <Text style={{ color: t.muted }}>{pro ? 'Bedankt! Je kunt onbeperkt scannen.' : '3 scans per week. Upgrade voor onbeperkt scannen.'}</Text>
        {!pro ? <Button title="Probeer Pro" onPress={() => router.push('/paywall')} /> : null}
      </View>
      <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 }}>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>Privacy</Text>
        <Text style={{ color: t.muted }}>Je brieven worden alleen tijdelijk naar de AI gestuurd om ze te lezen. Foto's worden niet opgeslagen; de uitleg staat alleen op deze telefoon.</Text>
        <Text style={{ color: t.primary }} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacybeleid</Text>
        <Text style={{ color: t.primary }} onPress={() => Linking.openURL(TERMS_URL)}>Voorwaarden</Text>
      </View>
      <Button
        variant="danger"
        title={`Wis al mijn data (${items.length})`}
        onPress={() => Alert.alert('Alles wissen?', 'Alle opgeslagen brieven en herinneringen worden verwijderd.', [{ text: 'Annuleer', style: 'cancel' }, { text: 'Wis', style: 'destructive', onPress: wipe }])}
      />
    </ScrollView>
  );
}
