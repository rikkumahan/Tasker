import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../../lib/supabase';
import { BRAND } from '../../lib/brand';
import { T } from '../../components/Theme';
import ServiceCard from '../../components/onboarding/ServiceCard';

WebBrowser.maybeCompleteAuthSession();

function GoogleIcon() {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 22 }}>G</Text>
    </View>
  );
}

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'taskerai' });

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          scopes: 'https://www.googleapis.com/auth/gmail.readonly',
          queryParams: { access_type: 'offline', prompt: 'consent' },
          skipBrowserRedirect: true,
        },
      });

      if (oauthError || !data?.url) throw oauthError || new Error('No OAuth URL');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

      if (result.type === 'success') {
        const url = new URL(result.url);
        const params = new URLSearchParams(url.hash.slice(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' });
        }
      }
    } catch (e) {
      setError('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container} bounces={false}>
      <View style={s.hero}>
        <View style={s.pill}>
          <Text style={s.pillText}>Early Access</Text>
        </View>
        <Text style={s.title}>
          Welcome to{' '}
          <Text style={{ color: T.accent }}>TaskerAI</Text>
        </Text>
        <Text style={s.tagline}>{BRAND.tagline}</Text>
        <Text style={s.subtitle}>
          Connect your Gmail to extract commitments, track blockers, and know what matters next.
        </Text>
      </View>

      <View style={s.cards}>
        <ServiceCard
          icon={<GoogleIcon />}
          name="Gmail"
          description="Extract tasks and commitments from your inbox"
          onConnect={handleGoogleLogin}
          loading={loading}
          primary
        />
        <ServiceCard
          icon={<Text style={{ fontSize: 24 }}>💬</Text>}
          name="Slack"
          description="Sync messages and action items from channels"
          badge="Coming Soon"
          primary={false}
        />
        <ServiceCard
          icon={<Text style={{ fontSize: 24 }}>🟦</Text>}
          name="Microsoft Teams"
          description="Import tasks from Teams conversations"
          badge="Coming Soon"
          primary={false}
        />
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: T.bg,
    paddingHorizontal: T.sp6,
    paddingTop: 72,
    paddingBottom: T.sp8,
    gap: T.sp8,
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' : undefined,
    width: '100%',
  },
  hero: { gap: T.sp3 },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: T.warmSurface,
    borderWidth: 1,
    borderColor: T.warmBorder,
    borderRadius: T.radiusPill,
    paddingHorizontal: T.sp3,
    paddingVertical: 4,
  },
  pillText: { fontSize: T.textXs, color: T.accent, fontWeight: '600', letterSpacing: 0.5 },
  title: { fontSize: 28, fontWeight: '700', color: T.fg, lineHeight: 36 },
  tagline: { fontSize: T.textXs, color: T.muted, letterSpacing: 0.7 },
  subtitle: { fontSize: T.textSm, color: T.fg2, lineHeight: 22 },
  cards: { gap: T.sp3 },
  error: { fontSize: T.textSm, color: T.danger || '#ef4444', textAlign: 'center' },
});
