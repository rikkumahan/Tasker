import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import useAuthStore from '../store/authStore';

const ONBOARDING_ROUTES = {
  lookback: '/(onboarding)/step-lookback',
  tracking: '/(onboarding)/step-tracking',
  sources: '/(onboarding)/step-sources',
  progress: '/(onboarding)/progress',
};

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const initAuth = useAuthStore((s) => s.initAuth);
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const wizardStep = useAuthStore((s) => s.wizardStep);

  // Initialize auth on mount, clean up listener on unmount
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []);

  // Navigation guard — runs in useEffect, never during render
  // This prevents the "Maximum update depth exceeded" loop that <Redirect> causes
  useEffect(() => {
    console.log('[RootLayout guard] run. isLoading:', isLoading, 'session:', !!session, 'wizardStep:', wizardStep, 'segments:', segments);
    if (isLoading) {
      console.log('[RootLayout guard] isLoading is true, skipping routing.');
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';

    console.log('[RootLayout guard] session:', !!session, 'wizardStep:', wizardStep, 'segments:', segments.join('/'), 'inAuthGroup:', inAuthGroup, 'inOnboardingGroup:', inOnboardingGroup);

    if (!session) {
      // Not signed in → go to login (only if not already there)
      if (!inAuthGroup) {
        console.log('[RootLayout guard] Not signed in, redirecting to login');
        router.replace('/(auth)/login');
      }
      return;
    }

    // Signed in + wizard in progress → go to correct wizard step
    if (wizardStep && ONBOARDING_ROUTES[wizardStep]) {
      const isOnProgressScreen = segments[0] === '(onboarding)' && segments[1] === 'progress';
      const needsRedirect = wizardStep === 'progress' ? !isOnProgressScreen : !inOnboardingGroup;
      if (needsRedirect) {
        console.log('[RootLayout guard] Redirecting to wizard step:', ONBOARDING_ROUTES[wizardStep]);
        router.replace(ONBOARDING_ROUTES[wizardStep]);
      }
      return;
    }

    // Signed in + no wizard → go to tabs (only if still on auth/onboarding screens)
    if (inAuthGroup || inOnboardingGroup) {
      console.log('[RootLayout guard] Signed in + no wizard, redirecting to tabs');
      router.replace('/(tabs)');
    } else {
      console.log('[RootLayout guard] Guard complete: user is active and on tabs.');
    }
  }, [session, isLoading, wizardStep, segments]);

  // Always render the Stack — navigation happens via useEffect above
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
