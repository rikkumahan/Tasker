// ─────────────────────────────────────────────────────────────────────────────
// useBreakpoint — Single source of truth for all breakpoint logic
// Never write `width >= 768` anywhere else — always import from here.
// ─────────────────────────────────────────────────────────────────────────────

import { useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  tablet:  768,
  desktop: 1024,
};

/**
 * Returns platform-aware breakpoint flags.
 * Reactive — updates automatically when window is resized on web.
 */
export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return {
    isMobile:  width < BREAKPOINTS.tablet,
    isTablet:  width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop,
    isDesktop: width >= BREAKPOINTS.desktop,
  };
}
