// ─────────────────────────────────────────────────────────────────────────────
// _layout.web.js — Web root layout (Metro picks this over _layout.js on web)
// Shows WebShell (sidebar + Slot) when authenticated, bare Slot otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import WebShell from '../components/web/WebShell';
import useAuthStore from '../store/authStore';
import useAppStore from '../store/appStore';

const ONBOARDING_ROUTES = {
  lookback: '/(onboarding)/step-lookback',
  tracking: '/(onboarding)/step-tracking',
  sources: '/(onboarding)/step-sources',
  progress: '/(onboarding)/progress',
};

export default function WebRootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const initAuth = useAuthStore((s) => s.initAuth);
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const wizardStep = useAuthStore((s) => s.wizardStep);

  const fetchAll = useAppStore((s) => s.fetchAll);
  const initRealtime = useAppStore((s) => s.initRealtime);
  const destroyRealtime = useAppStore((s) => s.destroyRealtime);

  // Initialize auth on mount, clean up listener on unmount
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []);

  // Initialize app store data and realtime listener on Web
  useEffect(() => {
    if (session?.user?.id) {
      fetchAll();
      initRealtime(session.user.id);
    }
    return () => {
      destroyRealtime();
    };
  }, [session, fetchAll, initRealtime, destroyRealtime]);

  // Navigation guard — runs in useEffect, never during render
  useEffect(() => {
    if (isLoading) return;

    // Prevent immediate redirect to login page if we have OAuth hash/search parameters,
    // which would wipe the tokens before Supabase can parse the session.
    if (!session && typeof window !== 'undefined') {
      const hasHash = window.location.hash && (window.location.hash.includes('access_token=') || window.location.hash.includes('error='));
      const hasSearch = window.location.search && (window.location.search.includes('code=') || window.location.search.includes('error='));
      if (hasHash || hasSearch) {
        return;
      }
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';

    if (!session) {
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    if (wizardStep && ONBOARDING_ROUTES[wizardStep]) {
      const isOnProgressScreen = segments[0] === '(onboarding)' && segments[1] === 'progress';
      const needsRedirect = wizardStep === 'progress' ? !isOnProgressScreen : !inOnboardingGroup;
      if (needsRedirect) router.replace(ONBOARDING_ROUTES[wizardStep]);
      return;
    }

    if (inAuthGroup || inOnboardingGroup) {
      router.replace('/(tabs)');
    }
  }, [session, isLoading, wizardStep, segments]);

  // Unauthenticated or onboarding: bare Slot (no sidebar)
  const showShell = session && !isLoading && !wizardStep;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {showShell ? <WebShell /> : <Slot />}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
