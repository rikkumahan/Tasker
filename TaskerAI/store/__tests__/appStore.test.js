// ISSUE-6 (frontend layer): useAppStore must be resettable so cached data
// from a previous signed-in user can't leak into the UI after an account
// switch. See TaskerAI/e2e/ISSUES.md.

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: jest.fn() },
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import useAppStore from '../appStore';

const seedWithFakeUserData = () => {
  useAppStore.setState({
    threads: [{ id: 't1' }],
    contacts: [{ id: 'c1' }],
    projects: [{ id: 'p1' }],
    userSettings: { gmail_email: 'previous-user@example.com' },
    loading: true,
    refreshing: true,
    error: 'some previous error',
    _lastFetchedAt: Date.now(),
  });
};

describe('useAppStore reset()', () => {
  beforeEach(() => {
    seedWithFakeUserData();
  });

  it('clears all cached-data fields back to their initial empty state', () => {
    expect(typeof useAppStore.getState().reset).toBe('function');

    useAppStore.getState().reset();

    const state = useAppStore.getState();
    expect(state.threads).toEqual([]);
    expect(state.contacts).toEqual([]);
    expect(state.projects).toEqual([]);
    expect(state.userSettings).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.refreshing).toBe(false);
    expect(state.error).toBeNull();
    expect(state._lastFetchedAt).toBeNull();
  });
});
