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
  _callbackInProgress: false,
  _lastProcessedUrl: null,

  initAuth: () => {
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          console.warn('[initAuth] getSession returned error:', error);
          supabase.auth.signOut().catch(() => {});
          set({ session: null, isLoading: false });
          return;
        }
        if (session) {
          set({ session, isLoading: true });
          get().checkSyncHealth(session);
        } else {
          set({ session, isLoading: false });
        }
      })
      .catch((err) => {
        console.error('[initAuth] getSession rejected:', err);
        supabase.auth.signOut().catch(() => {});
        set({ session: null, isLoading: false });
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      set({ session });
      // Only bootstrap on a FRESH sign-in that carries a live provider_token.
      // Session restores from AsyncStorage fire SIGNED_IN too, but provider_token is null there.
      const hasProviderToken = session?.provider_token || get().providerToken;
      if (event === 'SIGNED_IN') {
        if (hasProviderToken) {
          get().bootstrapUser(session);
        }
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
          isLoading: false,
        });
        get()._clearPoll();
      }
    });

    // Return unsubscribe so _layout.js can clean up on unmount
    return () => subscription.unsubscribe();
  },

  handleOAuthCallback: async (url) => {
    console.log('[DEBUG AUTH] handleOAuthCallback triggered with URL:', url);
    if (get()._lastProcessedUrl === url) {
      console.log('[DEBUG AUTH] URL already processed, skipping.');
      return;
    }
    if (get().session) {
      console.log('[DEBUG AUTH] Session already exists.');
      if (!get().providerToken) {
        console.log('[DEBUG AUTH] Extracting provider token from URL...');
        const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
        const providerToken = params.get('provider_token');
        const providerRefreshToken = params.get('provider_refresh_token');
        if (providerToken) {
          console.log('[DEBUG AUTH] Found provider token in URL, updating store.');
          set({
            _lastProcessedUrl: url,
            providerToken,
            providerRefreshToken: providerRefreshToken || null,
          });
          await get().bootstrapUser(get().session);
          return;
        }
      }
      console.log('[DEBUG AUTH] Skipping exchange.');
      return;
    }
    if (get()._callbackInProgress) {
      console.log('[DEBUG AUTH] handleOAuthCallback already in progress, ignoring duplicate call.');
      return;
    }
    set({ _lastProcessedUrl: url, _callbackInProgress: true, isLoading: true });

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
          set({ isLoading: false });
        }
      }
    } catch (e) {
      console.error('[DEBUG AUTH] handleOAuthCallback caught error:', e);
      set({ errorMessage: 'Authentication failed. Please try signing in again.', isLoading: false });
    } finally {
      set({ _callbackInProgress: false });
    }
  },

  bootstrapUser: async (session) => {
    console.log('[bootstrapUser] started. user_id:', session?.user?.id);
    // Guard: only run once per app lifecycle (not on token refresh)
    if (get()._bootstrapTriggered) {
      console.log('[bootstrapUser] already triggered, skipping.');
      return;
    }
    // ponytail: reuse isLoading to suspend routing guard until onboarding query resolves
    set({ _bootstrapTriggered: true, isLoading: true });

    try {
      console.log('[bootstrapUser] Querying user_settings...');
      const { data: settings, error } = await supabase
        .from('user_settings')
        .select('onboarding_status')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error) {
        console.error('[bootstrapUser] Query returned database error:', error);
      }
      console.log('[bootstrapUser] user_settings query completed. result:', settings);

      // Returning user — skip wizard entirely
      if (settings?.onboarding_status === 'complete') {
        console.log('[bootstrapUser] Onboarding complete. Skipping wizard.');
        set({ isLoading: false });
        return;
      }

      // Mid-onboarding — resume progress screen
      if (isInProgress(settings?.onboarding_status)) {
        console.log('[bootstrapUser] Onboarding in progress. Resume progress screen.');
        set({ wizardStep: 'progress', isLoading: false });
        get()._startPoll(session);
        return;
      }

      // New user — capture token and start wizard
      console.log('[bootstrapUser] New user detected. Redirecting to lookback...');
      // Preserve parsed providerToken if not in session
      const finalProviderToken = session.provider_token || get().providerToken;
      const finalProviderRefreshToken = session.provider_refresh_token || get().providerRefreshToken;
      console.log('[bootstrapUser] finalProviderToken:', !!finalProviderToken);
      set({
        providerToken: finalProviderToken,
        providerRefreshToken: finalProviderRefreshToken,
        wizardStep: 'lookback',
        isLoading: false,
      });
      console.log('[bootstrapUser] wizardStep set to lookback in store.');
    } catch (e) {
      console.error('[bootstrapUser] caught exception:', e);
      set({ errorMessage: 'Failed to check onboarding status.', isLoading: false });
    }
  },

  checkSyncHealth: async (session) => {
    // Guard: only run once per session restore
    if (get()._initialSyncDone) return;
    // ponytail: reuse isLoading to suspend routing guard until onboarding query resolves
    set({ _initialSyncDone: true, isLoading: true });

    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('onboarding_status, onboarding_progress')
        .eq('user_id', session.user.id)
        .maybeSingle();

      // Completed — skip, never show wizard again
      if (settings?.onboarding_status === 'complete') {
        set({ isLoading: false });
        return;
      }

      // Mid-onboarding still in progress — resume polling
      if (isInProgress(settings?.onboarding_status)) {
        if (settings.onboarding_progress) set({ onboardingProgress: settings.onboarding_progress });
        set({ wizardStep: 'progress', isLoading: false });
        get()._startPoll(session);
        return;
      }

      // onboarding_status is null: new user who just signed in via OAuth.
      // If provider_token is present on the session or in store, start the wizard.
      if (!settings || settings.onboarding_status === null) {
        const finalProviderToken = session?.provider_token || get().providerToken;
        if (finalProviderToken) {
          set({
            providerToken: finalProviderToken,
            providerRefreshToken: session?.provider_refresh_token || get().providerRefreshToken,
            wizardStep: 'lookback',
            isLoading: false,
          });
        } else {
          // No provider token available to complete onboarding — sign out to force re-auth
          console.warn('[checkSyncHealth] Non-onboarded user restored without providerToken. Signing out.');
          await get().signOut();
          set({ isLoading: false });
        }
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      console.error('[checkSyncHealth] error:', e);
      set({ errorMessage: 'Failed to check sync health.', isLoading: false });
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
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[signOut] error:', e);
    }
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
