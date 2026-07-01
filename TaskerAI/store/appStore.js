import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import useAuthStore from './authStore';

const CACHE_LIFETIME_MS = 60000; // 60 seconds SWR window

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.replace(/['"]/g, '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatTimeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diffMs = new Date() - new Date(dateStr);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 0) return 'now';
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const _formatThread = (t, projects) => {
  const firstEmail = (t.emails && t.emails.length > 0) ? t.emails[0] : null;
  const contact = firstEmail?.contacts ?? null;
  const initials = getInitials(contact?.name);
  const timeAgo = formatTimeAgo(t.created_at);
  const projectName = projects.find(p => p.id === t.project_id)?.name || 'General';

  // Extract related unique contacts from all emails in the thread
  const emailContacts = t.emails
    ? t.emails
        .map(e => e.contacts?.name)
        .filter((name, idx, self) => name && self.indexOf(name) === idx)
    : [];

  const primaryAction = t.action_items && t.action_items.length > 0
    ? (typeof t.action_items[0] === 'string' ? t.action_items[0] : t.action_items[0].description || t.action_items[0].title || 'Review thread')
    : 'No action items identified.';

  return {
    id: t.id,
    gmail_thread_id: t.gmail_thread_id,
    gmailUrl: `https://mail.google.com/mail/u/0/#all/${t.gmail_thread_id}`,
    title: t.subject,
    subject: t.subject,
    timeAgo,
    initials,
    project: projectName,
    priority: (t.urgency || 'MEDIUM').toLowerCase(),
    assignedFrom: contact?.name || 'Unknown',
    senderEmail: contact?.email || 'Unknown',
    aiSummary: t.ai_summary || '',
    aiContext: t.semantic_summary || t.ai_summary || 'No additional context available.',
    action: primaryAction,
    action_type: t.action_type || 'view',
    action_items: t.action_items || [],
    relatedPeople: emailContacts.length > 0 ? emailContacts : [contact?.name || 'Unknown'],
    suggestedReply: t.suggested_reply || null,
    is_read: t.is_read || false,
    created_at: t.created_at,
  };
};

const useAppStore = create((set, get) => ({
  threads: [],
  contacts: [],
  projects: [],
  userSettings: null,
  loading: false,
  refreshing: false,
  error: null,

  _lastFetchedAt: null,
  _fetching: false,
  _channel: null,

  fetchAll: async (force = false) => {
    const session = useAuthStore.getState().session;
    if (!session) return;

    const now = Date.now();
    const { _lastFetchedAt, _fetching } = get();

    // SWR Cache Check
    if (!force && _lastFetchedAt && (now - _lastFetchedAt < CACHE_LIFETIME_MS)) {
      return;
    }

    if (_fetching) return;
    set({ _fetching: true });

    // If it's the very first load and we don't have data, show global loading spinner
    const isFirstLoad = get().threads.length === 0;
    if (isFirstLoad) {
      set({ loading: true, error: null });
    } else if (force) {
      set({ refreshing: true, error: null });
    }

    try {
      const [threadsRes, contactsRes, projectsRes, settingsRes] = await Promise.all([
        supabase
          .from('threads')
          .select('id, gmail_thread_id, subject, urgency, action_type, ai_summary, semantic_summary, action_items, suggested_reply, is_read, created_at, project_id, emails(sender_id, snippet, contacts(name, email))')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('contacts')
          .select('id, name, email, organization, bio_summary, created_at')
          .eq('user_id', session.user.id)
          .order('name', { ascending: true }),
        supabase
          .from('projects')
          .select('id, name, description, status, created_at')
          .eq('user_id', session.user.id)
          .order('name', { ascending: true }),
        supabase
          .from('user_settings')
          .select('gmail_email, last_synced_at, sync_status')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ]);

      if (threadsRes.error) throw threadsRes.error;
      if (contactsRes.error) throw contactsRes.error;
      if (projectsRes.error) throw projectsRes.error;
      if (settingsRes.error) throw settingsRes.error;

      const rawProjects = projectsRes.data || [];
      const formattedThreads = (threadsRes.data || []).map(t => _formatThread(t, rawProjects));
      const rawContacts = contactsRes.data || [];
      
      const formattedContacts = rawContacts.map(c => ({
        id: c.id,
        name: c.name || 'Unknown',
        initials: getInitials(c.name),
        email: c.email || '',
        org: c.organization || 'Internal',
        snippet: c.bio_summary || 'Contact resolved from email communications.',
      }));

      set({
        threads: formattedThreads,
        contacts: formattedContacts,
        projects: rawProjects,
        userSettings: settingsRes.data || null,
        _lastFetchedAt: Date.now(),
        error: null,
      });
    } catch (err) {
      console.error('[appStore fetchAll error]:', err);
      set({ error: err.message || 'Failed to sync with server.' });
    } finally {
      set({ loading: false, refreshing: false, _fetching: false });
    }
  },

  markRead: async (threadId) => {
    const { threads } = get();
    // Optimistic Update
    set({
      threads: threads.map(t => t.id === threadId ? { ...t, is_read: true } : t),
    });

    try {
      const { error } = await supabase
        .from('threads')
        .update({ is_read: true })
        .eq('id', threadId);
      if (error) throw error;
    } catch (err) {
      console.error('[appStore markRead error]:', err);
      // Revert optimistic update on failure
      set({
        threads: threads.map(t => t.id === threadId ? { ...t, is_read: false } : t),
      });
    }
  },

  initRealtime: (userId) => {
    const { _channel } = get();
    if (_channel) return; // subscription already active

    let debounceTimeout = null;

    const channel = supabase
      .channel('public:threads')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'threads', filter: `user_id=eq.${userId}` },
        () => {
          // Debounce fetching to batch updates from sync pipeline
          if (debounceTimeout) clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(() => {
            get().fetchAll(true);
          }, 800);
        }
      )
      .subscribe();

    set({ _channel: channel });
  },

  destroyRealtime: () => {
    const { _channel } = get();
    if (_channel) {
      supabase.removeChannel(_channel);
      set({ _channel: null });
    }
  },
}));

export default useAppStore;
