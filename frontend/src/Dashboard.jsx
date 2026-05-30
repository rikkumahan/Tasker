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
  const threads = threadsCache[activeFilter] || [];
  const [loading, setLoading]           = useState(true);
  const [activeView, setActiveView]     = useState('tasks');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedThread, setSelectedThread] = useState(null);
  const [nextOffset, setNextOffset]     = useState(0);
  const [userSettings, setUserSettings] = useState(null);
  const [syncing, setSyncing]           = useState(false);
  const debounceRef                     = useRef(null);
  const fetchingRef                     = useRef(false);

  const fetchThreads = async (filter = 'all', offset = 0, append = false) => {
    if (!session) return;
    if (fetchingRef.current && offset === 0) return;
    fetchingRef.current = true;
    const hasCache = !!threadsCacheRef.current[filter]?.length;
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
      
      threadsCacheRef.current = {
        ...threadsCacheRef.current,
        [filter]: newList
      };
      
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
      />
      <div className="db-main">
        {renderContent()}
      </div>
    </div>
  );
}
