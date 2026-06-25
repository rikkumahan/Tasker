import { useEffect } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useURL } from 'expo-linking';
import useAuthStore from '../../store/authStore';
import { T } from '../../components/Theme';

export default function AuthCallbackScreen() {
  const url = useURL();
  const errorMessage = useAuthStore((state) => state.errorMessage);
  const handleOAuthCallback = useAuthStore((state) => state.handleOAuthCallback);

  useEffect(() => {
    console.log('[DEBUG CALLBACK] auth-callback mounted, url:', url);
    if (url) {
      handleOAuthCallback(url).catch((err) => {
        console.error('[DEBUG CALLBACK] handleOAuthCallback rejected:', err);
      });
    }
  }, [url]);

  return (
    <View style={s.container}>
      {errorMessage ? (
        <Text style={s.error}>{errorMessage}</Text>
      ) : (
        <ActivityIndicator size="large" color={T.accent || '#6c63ff'} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg || '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  error: {
    color: '#ef4444',
    textAlign: 'center',
    fontSize: 16,
  },
});
