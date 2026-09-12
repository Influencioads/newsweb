import { Tabs } from 'expo-router';

import { useI18n } from '@/lib/i18n';
import { TabIcon, type IconName } from '@/ui/Icon';
import { TabBar } from '@/ui/TabBar';

/** Bottom tab bar (DailyHunt-benchmarked): Home · Local · Video · Search · Profile. */

const TABS: { name: string; icon: IconName; title: 'tab.home' | 'tab.local' | 'tab.videos' | 'tab.search' | 'tab.profile' }[] = [
  { name: 'index', icon: 'home', title: 'tab.home' },
  { name: 'local', icon: 'mapPin', title: 'tab.local' },
  { name: 'videos', icon: 'play', title: 'tab.videos' },
  { name: 'search', icon: 'search', title: 'tab.search' },
  { name: 'profile', icon: 'user', title: 'tab.profile' },
];

export default function TabsLayout() {
  const { t } = useI18n();

  // No tab badge: the inbox is reached from the Home masthead bell, which
  // carries the unread count; Profile has no inbox row to resolve one.
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      {TABS.map(({ name, icon, title }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(title),
            // TabBar hands over a palette string; String() only widens the ColorValue type.
            tabBarIcon: ({ focused, color }) => <TabIcon name={icon} focused={focused} color={String(color)} />,
          }}
        />
      ))}
    </Tabs>
  );
}
