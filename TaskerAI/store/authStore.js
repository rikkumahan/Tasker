import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const POLL_INTERVAL_MS = 10000;
const isInProgress = (s) => s === 'queued' || s === 'processing';

const DEFAULT_WIZARD_FLAGS = {
  lookbackDays: 30,
  trackingPrefs: ['tasks', 'deadlines', 'people', 'projects'],
  gmailLabels: ['IMPORTANT', 'INBOX'],
  customLabelIds: [],
  otherText: '',
};

const useAuthStore = create((set, get) => ({
  session: null,
  isLoading: true,
  providerToken: null,
  providerRefreshToken: null,
  wizardStep: null,
  onboardingProgress: {},
  wizardFlags: { ...DEFAULT_WIZARD_FLAGS },
  errorMessage: null,
  _bootstrapTriggered: false,
  _initialSyncDone: false,
  _pollInterval: null,

  initAuth: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, isLoading: false });
      if (session) get().checkSyncHealth(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      set({ session });
      // Only bootstrap on a FRESH sign-in that carries a live provider_token.
      // Session restores from AsyncStorage fire SIGNED_IN too, but provider_token is null there.
      const hasProviderToken = session?.provider_token || get().providerToken;
      if (event === 'SIGNED_IN' && hasProviderToken) {
        get().bootstrapUser(session);
      }
      if (event === 'SIGNED_OUT') {
        set({
          wizardStep: null,
          providerToken: null,
          providerRefreshToken: null,
          _bootstrapTriggered: false,
          _initialSyncDone: false,
          errorMessage: null,
          wizardFlags: { ...DEFAULT_WIZARD_FLAGS },
        });
        get()._clearPoll();
      }
    });

    // Return unsubscribe so _layout.js can clean up on unmount
    return () => subscription.unsubscribe();
  },

  handleOAuthCallback: async (url) => {
    console.log('[DEBUG AUTH] handleOAuthCallback triggered with URL:', url);
    // Guard: If we already have a session, don't exchange the code again
    if (get().session) {
      console.log('[DEBUG AUTH] Session already exists, skipping exchange.');
      return;
    }

    try {
      if (url.includes('code=')) {
        console.log('[DEBUG AUTH] URL has PKCE code, starting exchangeCodeForSession...');
        
        let exchangeUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');
          const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
          // Use /functions/v1/mobile-auth-bridge/redirect?code=... as the exchange URL
          // so the SDK extracts the whitelisted HTTPS bridge path as redirect_uri.
          exchangeUrl = `${supabaseUrl}/functions/v1/mobile-auth-bridge/redirect?code=${code}`;
          console.log('[DEBUG AUTH] Mobile deep link, using exchange URL:', exchangeUrl);
        }

        const { data, error } = await supabase.auth.exchangeCodeForSession(exchangeUrl);
        if (error) {
          console.error('[DEBUG AUTH] exchangeCodeForSession failed:', error);
          throw error;
        }
        console.log('[DEBUG AUTH] exchangeCodeForSession success, session:', !!data?.session);
        if (data?.session) {
          set({
            providerToken: data.session.provider_token || null,
            providerRefreshToken: data.session.provider_refresh_token || null,
          });
          // Call bootstrapUser directly to avoid the onAuthStateChange race condition
          await get().bootstrapUser(data.session);
        }
      } else {
        console.log('[DEBUG AUTH] URL has no PKCE code, parsing query/hash...');
        // ponytail: parse hash fragment or query string natively
        const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
        const accessToken = params.get('access_token');
        console.log('[DEBUG AUTH] Parsed access_token:', !!accessToken);
        if (accessToken) {
          set({
            providerToken: params.get('provider_token') || null,
            providerRefreshToken: params.get('provider_refresh_token') || null,
          });
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: params.get('refresh_token') || '',
          });
          if (error) {
            console.error('[DEBUG AUTH] setSession failed:', error);
            throw error;
          }
          console.log('[DEBUG AUTH] setSession success');
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await get().bootstrapUser(session);
          }
        } else {
          console.warn('[DEBUG AUTH] No access_token or code found in URL:', url);
        }
      }
    } catch (e) {
      console.error('[DEBUG AUTH] handleOAuthCallback caught error:', e);
      set({ errorMessage: 'Authentication failed. Please try signing in again.' });
    }
  },

  bootstrapUser: async (session) => {
    // Guard: only run once per app lifecycle (not on token refresh)
    if (get()._bootstrapTriggered) return;
    set({ _bootstrapTriggered: true });

    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('onboarding_status')
        .eq('user_id', session.user.id)
        .maybeSingle();

      // Returning user — skip wizard entirely
      if (settings?.onboarding_status === 'complete') return;

      // Mid-onboarding — resume progress screen
      if (isInProgress(settings?.onboarding_status)) {
        set({ wizardStep: 'progress' });
        get()._startPoll(session);
        return;
      }

      // New user — capture token and start wizard
      set({
        providerToken: session.provider_token,
        providerRefreshToken: session.provider_refresh_token,
        wizardStep: 'lookback',
      });
    } catch (e) {
      set({ errorMessage: 'Failed to check onboarding status.' });
    }
  },

  checkSyncHealth: async (session) => {
    // Guard: only run once per session restore
    if (get()._initialSyncDone) return;
    set({ _initialSyncDone: true });

    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('onboarding_status, onboarding_progress')
        .eq('user_id', session.user.id)
        .maybeSingle();

      // Completed — skip, never show wizard again
      if (settings?.onboarding_status === 'complete') return;

      // Mid-onboarding still in progress — resume polling
      if (isInProgress(settings?.onboarding_status)) {
        if (settings.onboarding_progress) set({ onboardingProgress: settings.onboarding_progress });
        set({ wizardStep: 'progress' });
        get()._startPoll(session);
        return;
      }

      // onboarding_status is null: new user who just signed in via OAuth.
      // If provider_token is present on the session, start the wizard.
      // This handles the case where detectSessionInUrl already parsed the token
      // before bootstrapUser fires (e.g. on web with hash restore).
      if (!settings || settings.onboarding_status === null) {
        if (session?.provider_token) {
          set({
            providerToken: session.provider_token,
            providerRefreshToken: session.provider_refresh_token,
            wizardStep: 'lookback',
          });
        }
        // No provider_token → user needs to do a fresh OAuth sign-in — do nothing.
      }
    } catch (e) {
      set({ errorMessage: 'Failed to check sync health.' });
    }
  },

  handleWizardComplete: async () => {
    const { providerToken, providerRefreshToken, wizardFlags, session } = get();
    if (!session) return;

    try {
      const { data, error } = await supabase.functions.invoke('sync', {
        body: {
          providerToken,
          providerRefreshToken,
          bootstrap_only: true,
          sync_flags: {
            lookback_days: wizardFlags.lookbackDays,
            tracking_preferences: [
              ...wizardFlags.trackingPrefs,
              ...(wizardFlags.otherText?.trim() ? [wizardFlags.otherText.trim()] : []),
            ],
            gmail_labels: wizardFlags.gmailLabels,
            custom_label_ids: wizardFlags.customLabelIds,
          },
        },
      });
      if (error) throw error;
      // Seed progress from sync response (mirrors frontend App.jsx lines 199-203)
      set({
        onboardingProgress: {
          threads_total: 0,
          threads_done: 0,
          eta_seconds: data?.estimated_total_seconds || 300,
          queue_position: data?.queue_position || 0,
        },
        wizardStep: 'progress',
      });
      get()._startPoll(session);
    } catch (e) {
      set({ errorMessage: 'Failed to start sync. Please try again.' });
    }
  },

  signOut: async () => {
    get()._clearPoll();
    await supabase.auth.signOut();
  },

  setWizardFlags: (partial) =>
    set((state) => ({ wizardFlags: { ...state.wizardFlags, ...partial } })),

  clearError: () => set({ errorMessage: null }),

  _startPoll: (session) => {
    get()._clearPoll();
    const interval = setInterval(async () => {
      try {
        const { data: settings } = await supabase
          .from('user_settings')
          .select('onboarding_status, onboarding_progress')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (settings?.onboarding_progress) {
          set({ onboardingProgress: settings.onboarding_progress });
        }
        if (settings?.onboarding_status === 'complete') {
          get()._clearPoll();
          set({ wizardStep: null });
        }
      } catch (e) {
        console.error('[POLL] onboarding_status error:', e);
      }
    }, POLL_INTERVAL_MS);
    set({ _pollInterval: interval });
  },

  _clearPoll: () => {
    const { _pollInterval } = get();
    if (_pollInterval) {
      clearInterval(_pollInterval);
      set({ _pollInterval: null });
    }
  },
}));

export default useAuthStore;
