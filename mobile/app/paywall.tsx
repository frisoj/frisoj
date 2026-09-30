import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { PRIVACY_URL, TERMS_URL } from '../lib/config';
import { getPackages, purchase, purchasesAvailable, restore } from '../lib/purchases';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import { Button } from '../lib/ui';

const PERKS = ['Onbeperkt brieven scannen', 'Herinneringen vóór elke deadline', 'Conceptantwoorden op maat', 'Je data blijft op je telefoon'];

export default function Paywall() {
  const t = useTheme();
  const { refreshPro } = useStore();
  const [pkgs, setPkgs] = useState<PurchasesPackage[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getPackages().then(setPkgs); }, []);

  async function run(fn: () => Promise<boolean>, failMsg: string) {
    setBusy(true);
    try {
      if (await fn()) { await refreshPro(); router.back(); } else if (failMsg) Alert.alert(failMsg);
    } catch {
      Alert.alert('Aankoop mislukt', 'Probeer het later opnieuw.');
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text style={{ fontSize: 30, fontWeight: '800', color: t.text }}>Nooit meer een deadline missen</Text>
      <View style={{ gap: 8 }}>
        {PERKS.map((p) => <Text key={p} style={{ color: t.text, fontSize: 17 }}>✓  {p}</Text>)}
      </View>
      {pkgs === null ? <ActivityIndicator color={t.primary} /> : null}
      {pkgs?.map((p) => (
        <Button key={p.identifier} disabled={busy} title={`${p.product.title.replace(/\s*\(.*\)$/, '')} — ${p.product.priceString}`} onPress={() => run(() => purchase(p), '')} />
      ))}
      {pkgs && !pkgs.length ? <Text style={{ color: t.muted }}>{purchasesAvailable() ? 'Abonnementen zijn tijdelijk niet beschikbaar.' : 'Abonnementen zijn alleen beschikbaar in de gepubliceerde app.'}</Text> : null}
      <Button variant="ghost" disabled={busy} title="Aankopen herstellen" onPress={() => run(restore, 'Geen actief abonnement gevonden.')} />
      <Text style={{ color: t.muted, fontSize: 12 }}>Het abonnement wordt automatisch verlengd tenzij je minstens 24 uur voor het einde van de periode opzegt in je App Store- of Play Store-account. Betaling gaat via je store-account.</Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Text style={{ color: t.primary }} onPress={() => Linking.openURL(TERMS_URL)}>Voorwaarden</Text>
        <Text style={{ color: t.primary }} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy</Text>
      </View>
    </ScrollView>
  );
}
