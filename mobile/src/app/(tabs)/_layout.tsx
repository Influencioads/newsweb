import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';

/** Bottom tab bar (DailyHunt-benchmarked): Home · Local · Search · Profile. */

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, color: focused ? color.brand : color.mutedLight }}>{glyph}</Text>
  );
}

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.brand,
        tabBarInactiveTintColor: color.mutedLight,
        tabBarStyle: { backgroundColor: color.paper, borderTopColor: color.rule, height: 62 },
        tabBarLabelStyle: { fontFamily: font.teluguSemiBold, fontSize: 11, marginBottom: 6 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="⌂" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="local"
        options={{
          title: t('tab.local'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="◉" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="videos"
        options={{
          title: t('tab.videos'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="▶" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('tab.search'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="⌕" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab.profile'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="♟" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
