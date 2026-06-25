// useTabBarPadding — Returns the exact bottom padding needed to clear the
// floating tab bar on mobile. Accounts for OS safe-area insets (home bar).
// Usage: pass the returned value as paddingBottom on any scrollable content.

import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_BAR_HEIGHT = 56;

export function useTabBarPadding() {
  const { bottom } = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + bottom;
}
