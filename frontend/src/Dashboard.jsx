import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';
import PeopleView from './PeopleView';
import ProjectsView from './ProjectsView';
import AskAIView from './AskAIView';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export default function Dashboard({ session, supabase, wizardStep, onSignOut }) {
  const [threadsCache, setThreadsCache] = useState({});
  const threadsCacheRef                 = useRef({});
  const lastFetchedRef                  = useRef({});
  const [loading, setLoading]           = useState(true);
  const [activeView, setActiveView]     = useState('tasks');
  const [activeFilter, setActiveFilter] = useState('all');
  const threads = threadsCache[activeFilter] || [];
  const [selectedThread, setSelectedThread] = useState(null);
  const [nextOffset, setNextOffset]     = useState(0);
  const [userSettings, setUserSettings] = useState(null);
  const [syncing, setSyncing]           = useState(false);
  const debounceRef                     = useRef(null);
  const fetchingRef                     = useRef(false);

  const fetchThreads = async (filter = 'all', offset = 0, append = false) => {
    if (!session) return;
    const now = Date.now();
    const hasCache = !!threadsCacheRef.current[filter]?.length;
    const lastFetched = lastFetchedRef.current[filter] || 0;

    // Stale-While-Revalidate: skip fetch if we already have cache and it's less than 15s old
    if (offset === 0 && !append && hasCache && (now - lastFetched < 15000)) {
      return;
    }

    fetchingRef.current = true;
    if (offset === 0 && !append && !hasCache) setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('api/feed', {
        body: { filter, limit: 20, offset },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;
      const incoming = data?.threads || [];
      
      const currentList = threadsCacheRef.current[filter] || [];
      const newList = append ? [...currentList, ...incoming] : incoming;
      
      const newCache = {
        ...threadsCacheRef.current,
        [filter]: newList
      };

      // Optimistically pre-populate other tabs if we just fetched 'all'
      // This guarantees zero loading screens when clicking tabs for the first time!
      if (filter === 'all' && offset === 0) {
        if (!newCache.important) newCache.important = newList.filter(t => t.urgency === 'URGENT' || t.urgency === 'HIGH');
        if (!newCache.action)   newCache.action   = newList.filter(t => ['reply','approve','review','join'].includes(t.action_type));
        if (!newCache.unread)   newCache.unread   = newList.filter(t => !t.is_read);
      }
      
      threadsCacheRef.current = newCache;
      lastFetchedRef.current[filter] = Date.now();
      
      setThreadsCache(threadsCacheRef.current);
      setNextOffset(data?.nextOffset ?? 0);
    } catch (e) {
      console.error('[Dashboard] fetchThreads error:', e);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  const fetchSettings = async () => {
    if (!session) return;
    const { data } = await supabase
      .from('user_settings')
      .select('last_synced_at, gmail_email, last_sync_error')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (data) setUserSettings(data);
  };

  useEffect(() => {
    fetchThreads('all', 0);
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (wizardStep === null) {
      fetchThreads(activeFilter, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep]);

  useEffect(() => {
    if (!supabase || !session) return;
    const channel = supabase
      .channel('db-threads-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchThreads(activeFilter, 0), 800);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeFilter]);

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    setSelectedThread(null);
    fetchThreads(filter, 0);
  };

  const handleLoadMore = () => {
    if (nextOffset > 0 && !fetchingRef.current) {
      fetchThreads(activeFilter, nextOffset, true);
    }
  };

  const handleManualSync = async () => {
    if (syncing || !session) return;
    setSyncing(true);
    try {
      await supabase.functions.invoke('sync', {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch (e) {
      console.error('[Dashboard] sync error:', e);
    } finally {
      setSyncing(false);
      fetchSettings();
      fetchThreads(activeFilter, 0);
    }
  };

  const baseThreads = threadsCache['all'] || [];
  const threadCounts = {
    inbox:    baseThreads.length,
    priority: baseThreads.filter(t => t.urgency === 'URGENT' || t.urgency === 'HIGH').length,
    unread:   baseThreads.filter(t => !t.is_read).length,
  };

  const renderContent = () => {
    switch (activeView) {
      case 'people':
        return <PeopleView supabase={supabase} session={session} />;
      case 'projects':
        return <ProjectsView supabase={supabase} session={session} />;
      case 'askai':
        return <AskAIView supabase={supabase} session={session} />;
      default:
        return (
          <>
            <TaskList
              threads={threads}
              loading={loading}
              selectedThread={selectedThread}
              activeFilter={activeFilter}
              onSelectThread={setSelectedThread}
              onFilterChange={handleFilterChange}
              onLoadMore={handleLoadMore}
              session={session}
            />
            <TaskDetail
              key={selectedThread?.id || 'empty'}
              thread={selectedThread}
              session={session}
              supabase={supabase}
            />
          </>
        );
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Are you sure you want to completely delete your account and all data? This cannot be undone.')) return;
    try {
      await supabase.functions.invoke('delete-account');
      window.location.reload();
    } catch (e) {
      console.error('[Dashboard] delete account error:', e);
      alert('Failed to delete account.');
    }
  };

  return (
    <div className="db-shell">
      <Sidebar
        activeView={activeView}
        threadCounts={threadCounts}
        userSettings={userSettings}
        syncing={syncing}
        session={session}
        onNavigate={(view) => { setActiveView(view); setSelectedThread(null); }}
        onSync={handleManualSync}
        onSignOut={onSignOut}
        onDeleteAccount={handleDeleteAccount}
      />
      <div className="db-main">
        {renderContent()}
      </div>
    </div>
  );
}
