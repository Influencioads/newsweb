import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { StyleSheet } from 'react-native';

import { palettes, type Palette, type ThemeName } from '@/lib/theme';
import { usePrefs } from '@/stores/prefs';

/**
 * Theming for the app (the web app's dark mode, brought to parity).
 *
 * The reader's stored choice wins; `system` follows the OS. Both are read
 * through hooks, so a change re-renders every screen that builds its styles
 * with `makeStyles` — which is what makes the switch instant rather than
 * needing a restart.
 */
export function useThemeName(): ThemeName {
  const preference = usePrefs((s) => s.theme);
  const system = useColorScheme();
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
}

export function useColors(): Palette {
  return palettes[useThemeName()];
}

/**
 * Build a themed stylesheet.
 *
 * Replaces a module-scope `StyleSheet.create({...})`: the factory receives the
 * active palette, and the result is cached per theme so switching back and
 * forth does not rebuild anything.
 *
 *     const useStyles = makeStyles((color) => ({ page: { backgroundColor: color.canvas } }));
 *     function Screen() { const styles = useStyles(); … }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (color: Palette) => T,
): () => T {
  const cache = new Map<ThemeName, T>();
  return function useStyles(): T {
    const name = useThemeName();
    return useMemo(() => {
      const cached = cache.get(name);
      if (cached) return cached;
      const created = StyleSheet.create(factory(palettes[name]));
      cache.set(name, created);
      return created;
    }, [name]);
  };
}
