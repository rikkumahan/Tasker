import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const POLL_INTERVAL_MS = 10000;

const DEFAULT_WIZARD_FLAGS = {
  lookbackDays: 30,
  trackingPrefs: [],
  gmailLabels: [],
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
  _pollInterval: null,

  initAuth: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, isLoading: false });
      if (session) get().checkSyncHealth(session);
    });

    supabase.auth.onAuthStateChange((event, session) => {
      set({ session });
      if (event === 'SIGNED_IN' && session?.provider_token) {
        get().bootstrapUser(session);
      }
      if (event === 'SIGNED_OUT') {
        set({
          wizardStep: null,
          providerToken: null,
          providerRefreshToken: null,
          _bootstrapTriggered: false,
          errorMessage: null,
          wizardFlags: { ...DEFAULT_WIZARD_FLAGS },
        });
        get()._clearPoll();
      }
    });
  },

  bootstrapUser: async (session) => {
    if (get()._bootstrapTriggered) return;
    set({ _bootstrapTriggered: true });

    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('onboarding_status')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (settings?.onboarding_status === 'complete') return;

      if (settings?.onboarding_status === 'queued' || settings?.onboarding_status === 'processing') {
        set({ wizardStep: 'progress' });
        get()._startPoll(session);
        return;
      }

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
    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('onboarding_status, onboarding_progress')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!settings || settings.onboarding_status === 'complete') return;

      if (settings.onboarding_status === 'queued' || settings.onboarding_status === 'processing') {
        if (settings.onboarding_progress) set({ onboardingProgress: settings.onboarding_progress });
        set({ wizardStep: 'progress' });
        get()._startPoll(session);
      }
    } catch (e) {
      set({ errorMessage: 'Failed to check sync health.' });
    }
  },

  handleWizardComplete: async () => {
    const { providerToken, providerRefreshToken, wizardFlags, session } = get();
    if (!session) return;

    try {
      const { error } = await supabase.functions.invoke('sync', {
        body: {
          providerToken,
          providerRefreshToken,
          bootstrap_only: true,
          sync_flags: {
            lookback_days: wizardFlags.lookbackDays,
            tracking_preferences: wizardFlags.trackingPrefs,
            gmail_labels: wizardFlags.gmailLabels,
            custom_label_ids: wizardFlags.customLabelIds,
          },
        },
      });
      if (error) throw error;
      set({ wizardStep: 'progress' });
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
