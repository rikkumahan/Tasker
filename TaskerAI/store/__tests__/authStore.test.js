// ISSUE-6 (frontend layer): confirms authStore's onAuthStateChange actually
// wires into useAppStore.reset() on SIGNED_OUT, not just that reset() exists
// in isolation. See TaskerAI/e2e/ISSUES.md.

let authStateChangeCallback = null;

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: jest.fn((cb) => {
        authStateChangeCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    },
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import useAppStore from '../appStore';
import useAuthStore from '../authStore';

describe('authStore SIGNED_OUT handling', () => {
  it('clears useAppStore cached data via reset() on SIGNED_OUT', () => {
    useAppStore.setState({
      threads: [{ id: 't1' }],
      contacts: [{ id: 'c1' }],
      projects: [{ id: 'p1' }],
    });

    useAuthStore.getState().initAuth();
    expect(authStateChangeCallback).toBeInstanceOf(Function);

    authStateChangeCallback('SIGNED_OUT', null);

    const state = useAppStore.getState();
    expect(state.threads).toEqual([]);
    expect(state.contacts).toEqual([]);
    expect(state.projects).toEqual([]);
  });
});
