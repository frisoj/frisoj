import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { FREE_SCANS_PER_WEEK } from '../../lib/quota';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { Button } from '../../lib/ui';

export default function Scan() {
  const t = useTheme();
  const { scan, pro, freeLeft } = useStore();
  const [busy, setBusy] = useState(false);

  async function run(source: 'camera' | 'library') {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: false };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Geen cameratoegang', 'Geef toegang in Instellingen of kies een foto uit je bibliotheek.');
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.assets?.[0];
    if (res.canceled || !asset?.base64) return;
    setBusy(true);
    try {
      const out = await scan(asset.base64, asset.mimeType ?? 'image/jpeg');
      if (out === 'paywall') return router.push('/paywall');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(`/item/${out}`);
    } catch (e) {
      Alert.alert('Scannen mislukt', e instanceof ApiError ? e.message : 'Onbekende fout.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: 20, justifyContent: 'center', gap: 14 }}>
      {busy ? (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>Ik lees je brief…</Text>
        </View>
      ) : (
        <>
          <Text style={{ color: t.text, fontSize: 28, fontWeight: '800' }}>Wat heb je ontvangen?</Text>
          <Text style={{ color: t.muted, fontSize: 16 }}>Brief, factuur, aanslag, e-mail of screenshot. Zorg dat de tekst goed leesbaar is.</Text>
          <Button title="📷  Maak een foto" onPress={() => run('camera')} />
          <Button title="🖼️  Kies uit bibliotheek" variant="ghost" onPress={() => run('library')} />
          <Text style={{ color: t.muted, textAlign: 'center' }}>{pro ? 'Pro · onbeperkt scannen' : `${freeLeft} van ${FREE_SCANS_PER_WEEK} gratis scans over deze week`}</Text>
        </>
      )}
    </View>
  );
}
