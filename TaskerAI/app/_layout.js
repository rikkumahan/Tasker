import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
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
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
