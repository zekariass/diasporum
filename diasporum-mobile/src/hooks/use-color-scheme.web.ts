import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * On web, `useColorScheme` may return null during static rendering before
 * client-side hydration. Default to 'light' to prevent a theme flash.
 */
export function useColorScheme() {
  return useRNColorScheme() ?? 'light';
}
