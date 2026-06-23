// ─────────────────────────────────────────────────────────────────────────────
// _layout.web.js — Web root layout (Metro picks this over _layout.js on web)
// Wraps the entire app in WebShell for sidebar navigation
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { Slot, Redirect } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import WebShell from '../components/web/WebShell';
import useAuthStore from '../store/authStore';

const ONBOARDING_ROUTES = {
  lookback: '/(onboarding)/step-lookback',
  tracking: '/(onboarding)/step-tracking',
  sources: '/(onboarding)/step-sources',
  progress: '/(onboarding)/progress',
};

export default function WebRootLayout() {
  const initAuth = useAuthStore((s) => s.initAuth);
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const wizardStep = useAuthStore((s) => s.wizardStep);

  useEffect(() => { initAuth(); }, []);

  if (isLoading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (session && wizardStep && ONBOARDING_ROUTES[wizardStep]) {
    return <Redirect href={ONBOARDING_ROUTES[wizardStep]} />;
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <WebShell />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
