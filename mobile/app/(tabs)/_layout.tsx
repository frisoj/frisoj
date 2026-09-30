import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../../lib/theme';

const icon = (e: string) => () => <Text style={{ fontSize: 20 }}>{e}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: t.primary, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border }, headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerShadowVisible: false }}>
      <Tabs.Screen name="index" options={{ title: 'Vandaag', tabBarIcon: icon('📬') }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: icon('📷') }} />
      <Tabs.Screen name="settings" options={{ title: 'Instellingen', tabBarIcon: icon('⚙️') }} />
    </Tabs>
  );
}
