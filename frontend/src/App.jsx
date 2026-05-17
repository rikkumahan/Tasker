import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { differenceInDays, isPast, isToday, isTomorrow, format, startOfDay } from 'date-fns';
import { ChevronDown, ChevronRight, Star, ExternalLink, RefreshCw, LogOut, Trash2, AlertCircle, Brain, X, Send } from 'lucide-react';
import Auth from './Auth';
import './index.css';

// Initialize Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

function parseLocalDate(isoStr) {
  if (!isoStr) return null;
  // Strip any 'Z' or '+00:00' timezone suffix forced by Postgres timestamptz
  // This violently forces the browser to interpret the literal string as Local Time
  const localIso = isoStr.replace(/(Z|[+-]\d{2}:\d{2})$/, '');
  return new Date(localIso);
}

function getUrgencyLevel(deadline) {
  if (!deadline) return 'GREEN';
  const parsed = parseLocalDate(deadline);
  const target = startOfDay(parsed);
  const today = startOfDay(new Date());

  if (isPast(parsed) || isToday(parsed)) {
    return 'RED';
  }

  const diff = differenceInDays(target, today);
  if (diff <= 3) {
    return 'YELLOW';
  }

  return 'GREEN';
}

function formatDeadline(iso, isoEnd) {
  if (!iso) return 'No deadline';
  const d = parseLocalDate(iso);
  
  const isMidnight = d.getHours() === 0 && d.getMinutes() === 0;
  let timeStr = format(d, 'h:mm a');
  
  if (isMidnight) {
     timeStr = ''; // It's an "All Day" event just showing the date
  }

  if (isoEnd) {
     const endD = parseLocalDate(isoEnd);
     if (!isMidnight) {
         timeStr += ` - ${format(endD, 'h:mm a')}`;
     }
  }

  const suffix = timeStr ? ` ${timeStr}` : '';

  if (isPast(d) && !isToday(d)) return `Overdue`;
  if (isToday(d)) return `Today${suffix}`;
  if (isTomorrow(d)) return `Tomorrow${suffix}`;

  const diffDays = differenceInDays(startOfDay(d), startOfDay(new Date()));
  if (diffDays < 7) return `${format(d, 'EEE')}${suffix}`;
  return `${format(d, 'MMM d')}${suffix}`;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [userSettings, setUserSettings] = useState(null);

  // ── AI Mind & Evolution Center State ──
  const [isMindOpen, setIsMindOpen] = useState(false);
  const [mindChat, setMindChat] = useState([]);
  const [mindInput, setMindInput] = useState('');
  const [mindLoading, setMindLoading] = useState(false);

  // ── Onboarding State ──
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingAnswers, setOnboardingAnswers] = useState(['', '', '']);
  const [onboardingChat, setOnboardingChat] = useState([]);
  const [onboardingInput, setOnboardingInput] = useState('');
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesisStatus, setSynthesisStatus] = useState('');
  const onboardingChatRef = React.useRef(null);
  const mindChatRef = React.useRef(null);

  // Store session and intervals in refs so they persist across renders and are accessible in cleanup
  const sessionRef = React.useRef(null);
  const pollRef = React.useRef(null);
  // Debounce refs for Realtime — prevents flicker from rapid-fire DB events during background sync
  const taskDebounceRef = React.useRef(null);
  const settingsDebounceRef = React.useRef(null);
  const initialSyncDoneRef = React.useRef(false); // Guard against recursive sync or onboarding loops
  const onboardingTriggeredRef = React.useRef(false); // Prevent double onboarding from race conditions

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session;
      setSession(session);
      if (session) {
        fetchTasks(session);
        // checkSyncHealth removed — onAuthStateChange handles onboarding + stale checks
        // Calling it here caused double-trigger on first sign-in (welcome task x4)
      }
    });

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      sessionRef.current = newSession;
      setSession(newSession);
      if (newSession) {
        // BUG FIX 3: Only onboard on true first-time SIGNED_IN, not on session restores.
        if (_event === 'SIGNED_IN' && newSession.provider_token) {
          handleOnboarding(newSession);
        } else {
          fetchTasks(newSession);
          checkSyncHealth(newSession);
        }
      } else {
        setTasks([]);
      }
    });

    // Realtime subscription — BUG FIX 1: use sessionRef so the closure is never stale
    // FIX (flicker): Both channels are debounced and use silent=true so the UI never
    // goes blank during background worker bursts. Tasks debounce=800ms, settings=1500ms
    // (longer delay avoids thrashing from sync_in_progress/sync_lock_at flag changes).
    let channel = null;
    let settingsChannel = null;
    if (supabase) {
      channel = supabase
        .channel('tasks-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
          if (!sessionRef.current) return;
          if (taskDebounceRef.current) clearTimeout(taskDebounceRef.current);
          taskDebounceRef.current = setTimeout(() => {
            fetchTasks(sessionRef.current, true); // silent — no loading spinner
          }, 800);
        })
        .subscribe();

      // Also listen for user_settings changes (e.g., categories updated by sync engine)
      settingsChannel = supabase
        .channel('settings-realtime')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_settings' }, () => {
          if (!sessionRef.current) return;
          if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
          settingsDebounceRef.current = setTimeout(() => {
            fetchTasks(sessionRef.current, true); // silent — no loading spinner
          }, 1500);
        })
        .subscribe();
    }

    return () => {
      if (channel && supabase) supabase.removeChannel(channel);
      if (settingsChannel && supabase) supabase.removeChannel(settingsChannel);
      if (pollRef.current) clearInterval(pollRef.current);
      if (taskDebounceRef.current) clearTimeout(taskDebounceRef.current);
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
    };
  }, []);

  // silent=true: skip loading spinner (used by Realtime debounce handlers to prevent flicker)
  const fetchTasks = async (sess, silent = false) => {
    const activeSess = sess || sessionRef.current;
    if (!supabase || !activeSess) { setLoading(false); return; }
    if (!silent) setLoading(true);

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', activeSess.user.id)
      .eq('status', 'pending')
      .order('deadline', { ascending: true, nullsFirst: false });
    if (!error && data) setTasks(data);

    // Fetch user settings for synced time + trigger lock
    const { data: settingsData, error: settingsError } = await supabase
      .from('user_settings')
      .select('last_synced_at, last_sync_triggered_at, user_profile, categories, last_sync_error, secrets')
      .eq('user_id', activeSess.user.id)
      .maybeSingle();

    if (settingsData) {
      setUserSettings(settingsData);
    } else if (!settingsError) {
      // NO SETTINGS AT ALL: Full Ghost User Recovery
      if (!activeSess.provider_token) {
        console.warn('[WARNING] User has no settings and no fresh provider token. Forcing sign-out.');
        await supabase.auth.signOut();
        setTasks([]);
        setSession(null);
      }
    }
    setLoading(false);
  };

  // Dedicated recovery and freshness checker
  // This runs EXACTLY ONCE on initial app load/auth restore.
  const checkSyncHealth = async (sess) => {
    if (initialSyncDoneRef.current || !sess) return;
    initialSyncDoneRef.current = true;
    
    // Fetch critical health metrics
    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_profile, last_synced_at')
      .eq('user_id', sess.user.id)
      .maybeSingle();
    
    if (!settings || !settings.user_profile || settings.user_profile.includes('A busy professional seeking to organize')) {
      console.log('[INFO] User needs onboarding. Showing AI Mind Center...');
      setShowOnboarding(true);
      setOnboardingStep(0);
      setOnboardingChat([{ sender: 'ai', text: "Hey there! 👋 I'm your Tasker AI companion. Let's get your inbox intelligence calibrated. First — tell me about yourself! What do you do, and what are your key priorities right now?" }]);
    } else if (settings.last_synced_at) {
      console.log(`[INFO] Last sync was ${Math.round((Date.now() - new Date(settings.last_synced_at).getTime()) / 60000)} mins ago. Use sync button to refresh.`);
    }
  };

  const handleOnboarding = async (sess) => {
    if (onboardingTriggeredRef.current) {
      console.log('[INFO] Onboarding already triggered, skipping duplicate call.');
      return;
    }
    onboardingTriggeredRef.current = true;
    setLoading(true);
    try {
        console.log('[INFO] Bootstrapping new user via Unified Sync pipeline...');
        const providerToken = sess?.provider_token;
        const providerRefreshToken = sess?.provider_refresh_token;
        
        // Connect directly to the progressive chunk loader instead of a separate onboard function
        await triggerSync(sess, null, { providerToken, providerRefreshToken });
        
        await fetchTasks(sess);
    } catch (e) {
        console.error("Onboarding error", e);
        // Clear session so the user gets cleanly kicked out if onboarding fatally fails
        // Or just leave them in loading state if preferred, but breaking the loop is key.
    }
    setLoading(false);
  };

  // Core sync trigger — shared by button AND auto-stale check
  const triggerSync = async (sess, freshSettings, bootstrapTokens = null) => {
    const activeSess = sess || sessionRef.current;
    if (!activeSess || syncing) return;

    // 60-second debounce lock via DB timestamp
    const settings = freshSettings || userSettings;
    if (settings?.last_sync_triggered_at) {
      const secsAgo = (Date.now() - new Date(settings.last_sync_triggered_at).getTime()) / 1000;
      if (secsAgo < 60) {
        console.log('[INFO] Sync locked — triggered recently. Skipping.');
        return;
      }
    }

    setSyncing(true);
    const triggerStart = Date.now();

    try {
      // THE V20 WAY: Trigger one burst. The server hands off history to the Background Worker.
      const payload = { body: bootstrapTokens || {} };
      const { data, error } = await supabase.functions.invoke('sync', {
        ...payload,
        headers: {
          // Supabase Edge Functions require BOTH apikey and Authorization.
          // Passing a custom headers object can override defaults, so include apikey explicitly.
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${activeSess.access_token}`
        }
      });

      
      if (error) {
        if (error.status === 429) {
           console.warn('[WARNING] Rate limit on initial trigger.');
        } else {
           throw error;
        }
      }

      console.log(`[V20] Initial burst complete. Remaining: ${data?.remaining || 0}`);
      
      // Fetch results of first burst
      await fetchTasks(activeSess); 
      
    } catch (e) {
      console.error('Sync trigger error:', e);
    } finally {
      // Ensure the "Syncing..." text is visible for at least 1.5s to prevent "flicker"
      const elapsed = Date.now() - triggerStart;
      const wait = Math.max(1500 - elapsed, 0);
      setTimeout(() => setSyncing(false), wait);
    }
  };

  const handleManualSync = () => triggerSync();

  // ── ONBOARDING STEP HANDLER ──
  const onboardingQuestions = [
    "Hey there! 👋 I'm your Tasker AI companion. Let's get your inbox intelligence calibrated. First — tell me about yourself! What do you do, and what are your key priorities right now?",
    "Got it! Now tell me about your email inbox. What kinds of emails do you receive? What's noise vs. important? (e.g., 'Lots of GitHub alerts, some client invoices, newsletters I never read')",
    "Last one! What tasks do you actually want extracted from your emails? Be specific! (e.g., 'Only bills with due dates, meeting invites, and anything from my boss Sarah')"
  ];

  const handleOnboardingSubmit = async () => {
    const input = onboardingInput.trim();
    if (!input || synthesizing) return;

    const step = onboardingStep;
    const newAnswers = [...onboardingAnswers];
    newAnswers[step] = input;
    setOnboardingAnswers(newAnswers);
    setOnboardingInput('');

    // Add user bubble
    setOnboardingChat(prev => [...prev, { sender: 'user', text: input }]);

    if (step < 2) {
      // Show typing then next question
      setOnboardingStep(step + 1);
      setTimeout(() => {
        setOnboardingChat(prev => [...prev, { sender: 'ai', text: onboardingQuestions[step + 1] }]);
      }, 600);
    } else {
      // All 3 answers collected — synthesize!
      setSynthesizing(true);
      setSynthesisStatus('Synthesizing your cognitive lens...');

      try {
        const sess = sessionRef.current;
        const { data, error } = await supabase.functions.invoke('synthesize_profile', {
          body: { mode: 'onboarding', messages: newAnswers },
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${sess.access_token}`
          }
        });

        if (error) throw error;

        setSynthesisStatus('Calibrating extraction filters...');
        await new Promise(r => setTimeout(r, 800));
        setSynthesisStatus('AI Mind initialized!');
        await new Promise(r => setTimeout(r, 600));

        // Now trigger the actual first sync
        setShowOnboarding(false);
        setSynthesizing(false);
        await handleOnboarding(sess);
        await fetchTasks(sess);
      } catch (e) {
        console.error('Synthesis error:', e);
        setSynthesisStatus('Something went wrong. Proceeding with defaults...');
        await new Promise(r => setTimeout(r, 1500));
        setShowOnboarding(false);
        setSynthesizing(false);
        const sess = sessionRef.current;
        await handleOnboarding(sess);
      }
    }
  };

  // ── AI MIND OPEN CHAT HANDLER ──
  const handleMindChat = async () => {
    const msg = mindInput.trim();
    if (!msg || mindLoading) return;

    setMindInput('');
    setMindChat(prev => [...prev, { sender: 'user', text: msg }]);
    setMindLoading(true);

    try {
      const sess = sessionRef.current;
      const { data, error } = await supabase.functions.invoke('synthesize_profile', {
        body: { mode: 'chat', message: msg },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${sess.access_token}`
        }
      });

      if (error) throw error;

      setMindChat(prev => [...prev, { sender: 'ai', text: data.ai_response || 'Done! Your AI Mind has been updated.' }]);

      // Refresh settings to reflect new categories
      await fetchTasks(sess, true);
    } catch (e) {
      console.error('Mind chat error:', e);
      setMindChat(prev => [...prev, { sender: 'ai', text: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setMindLoading(false);
    }
  };

  // Auto-scroll chat areas
  React.useEffect(() => {
    if (onboardingChatRef.current) onboardingChatRef.current.scrollTop = onboardingChatRef.current.scrollHeight;
  }, [onboardingChat]);

  React.useEffect(() => {
    if (mindChatRef.current) mindChatRef.current.scrollTop = mindChatRef.current.scrollHeight;
  }, [mindChat]);

  const logAction = async (actionText) => {
    const activeSess = sessionRef.current;
    if (!activeSess || !supabase) return;
    try {
      const { data } = await supabase
        .from('user_settings')
        .select('recent_actions')
        .eq('user_id', activeSess.user.id)
        .single();
      const actions = data?.recent_actions || [];
      const newActions = [actionText, ...actions].slice(0, 15); // keep last 15
      await supabase.from('user_settings').update({ recent_actions: newActions }).eq('user_id', activeSess.user.id);
    } catch (e) { console.error("Telemetry error", e); }
  };

  const toggleStar = async (e, task) => {
    e.stopPropagation();
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, starred: !t.starred } : t));
    const { error } = await supabase.from('tasks').update({ starred: !task.starred }).eq('id', task.id);
    if (error) {
       setTasks(prev => prev.map(t => t.id === task.id ? { ...t, starred: task.starred } : t)); // Revert!
       console.error("Network error, sync failed.", error);
    } else {
       if (!task.starred) logAction(`Starred task: "${task.title}" (Category: ${task.category})`);
    }
  };

  const toggleComplete = async (e, task) => {
    e.stopPropagation();
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed' } : t));
    const { error } = await supabase.from('tasks').update({ status: 'completed' }).eq('id', task.id);
    if (error) {
       setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t)); // Revert!
       console.error("Network error, sync failed.", error);
    } else {
       logAction(`Completed task: "${task.title}" (Category: ${task.category})`);
    }
  };

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const deleteTask = async (e, task) => {
    e.stopPropagation();
    if (!window.confirm("Permanently delete this task?")) return;
    
    // Optimistic delete
    setTasks(prev => prev.filter(t => t.id !== task.id));
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
       setTasks(prev => [...prev, task]); // Revert!
       console.error("Network error, sync failed.", error);
    } else {
       logAction(`Deleted task: "${task.title}" (Category: ${task.category})`);
    }
  };

  // Filter & Group tasks
  const pendingTasks = tasks.filter(t => {
    if (t.status === 'completed') return false;

    // 1. Overdue Guard: Stay visible for 24hrs past deadline, then hide (unless STARRED)
    if (t.deadline) {
       const d = parseLocalDate(t.deadline);
       const now = new Date();
       const isOverdueByMoreThan24h = (now.getTime() - d.getTime()) > (24 * 60 * 60 * 1000);
       
       // Don't hide if it's Starred OR in a protected category
       const isProtected = t.starred || t.category === 'Onboarding' || t.category === 'System Status';

       if (isOverdueByMoreThan24h && !isToday(d) && !isProtected) {
          return false;
       }
    }

    // 2. 24hr auto-fade policy for non-deadlined items (except the special Check Out Mail category)
    if (!t.deadline && !t.starred && t.category !== 'Check_Out_Mail') {
      const createdDate = new Date(t.created_at || Date.now());
      const hoursOld = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60);
      if (hoursOld > 24) return false;
    }
    return true;
  });

  const grouped = pendingTasks.reduce((acc, task) => {
    const cat = task.category || 'uncategorized';
    if (!acc[cat]) {
      acc[cat] = { tasks: [], urgency: { RED: 0, YELLOW: 0, GREEN: 0 } };
    }

    const u = getUrgencyLevel(task.deadline);
    acc[cat].tasks.push(task);
    acc[cat].urgency[u]++;

    return acc;
  }, {});

  // Sort categories: Academic first, then by urgency (RED > YELLOW), Check_Out_Mail at the very bottom
  const categoryKeys = Object.keys(grouped).sort((a, b) => {
    const aIsAcad = a.toLowerCase().includes('academic');
    const bIsAcad = b.toLowerCase().includes('academic');
    const aIsCheckOut = a === 'Check_Out_Mail';
    const bIsCheckOut = b === 'Check_Out_Mail';

    if (aIsAcad && !bIsAcad) return -1;
    if (!aIsAcad && bIsAcad) return 1;

    if (aIsCheckOut && !bIsCheckOut) return 1;
    if (!aIsCheckOut && bIsCheckOut) return -1;

    const aUrgency = grouped[a].urgency;
    const bUrgency = grouped[b].urgency;

    if (aUrgency.RED !== bUrgency.RED) return bUrgency.RED - aUrgency.RED;
    if (aUrgency.YELLOW !== bUrgency.YELLOW) return bUrgency.YELLOW - aUrgency.YELLOW;

    return a.localeCompare(b);
  });

  if (!session) {
    return <Auth supabase={supabase} />
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-info">
          <h1>My Tasks</h1>
          <p className="date-display">{format(new Date(), 'EEEE, MMMM do')}</p>
          {userSettings?.user_profile && (
            <p className="profile-subheadline" title={userSettings.user_profile}>
              {userSettings.user_profile.length > 100 
                ? `${userSettings.user_profile.substring(0, 100)}...` 
                : userSettings.user_profile}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {syncing ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--yellow-color)', fontWeight: '600' }} className="pulse">
              ⚡ Syncing...
            </span>
          ) : userSettings?.last_sync_error ? (
            <div title={userSettings.last_sync_error} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}>
               <AlertCircle size={14} color="var(--red-color)" />
               <span style={{ fontSize: '0.75rem', color: 'var(--red-color)', fontWeight: '600' }}>Sync Error</span>
            </div>
          ) : userSettings?.last_synced_at && (
            <span className="last-synced-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Last synced: {format(new Date(userSettings.last_synced_at), 'h:mm a')}
            </span>
          )}
          <button
            onClick={() => { setIsMindOpen(true); if (mindChat.length === 0) setMindChat([{ sender: 'ai', text: 'Hey! I\'m your AI Mind companion. Ask me to adjust categories, track specific senders, or refine how I extract tasks from your inbox.' }]); }}
            className="mind-btn"
            title="AI Mind Center"
          >
            <Brain size={20} />
          </button>
          <button
            onClick={handleManualSync}
            className={`sync-btn ${syncing ? 'spinning' : ''}`}
            disabled={syncing || !supabase}
            title={syncing ? 'Sync in progress...' : 'Refresh Inbox'}
          >
            <RefreshCw size={20} />
          </button>
          
          <button
            onClick={() => supabase.auth.signOut()}
            className={`sync-btn`}
            title="Sign Out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="main-content">
        {!supabase ? (
          <div className="empty-state">
            <h2 style={{ color: 'var(--red-color)' }}>Connection Error</h2>
            <p style={{ marginTop: '0.5rem' }}>Missing <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code> in your <code>frontend/.env</code> file.</p>
          </div>
        ) : loading && Object.keys(grouped).length === 0 ? (
          <div className="loading-state">Loading your personalized dashboard...</div>
        ) : categoryKeys.length === 0 ? (
          <div className="empty-state">No pending tasks! 🎉</div>
        ) : (
          categoryKeys.map(cat => (
            <div key={cat} className={`category-accordion ${cat === 'Check_Out_Mail' ? 'checkout-mail' : ''}`}>
              <div
                className="accordion-header"
                onClick={() => toggleCategory(cat)}
              >
                <div className="accordion-title">
                  {expandedCategories[cat] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                  <h2>{cat.replace(/_/g, ' ').toUpperCase()}</h2>
                </div>
                {cat !== 'Check_Out_Mail' && (
                  <div className="urgency-indicators">
                    <div className="urgency-box red">{grouped[cat].urgency.RED}</div>
                    <div className="urgency-box yellow">{grouped[cat].urgency.YELLOW}</div>
                    <div className="urgency-box green">{grouped[cat].urgency.GREEN}</div>
                  </div>
                )}
              </div>

              {expandedCategories[cat] && (
                <div className="accordion-body">
                   {grouped[cat].tasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggleStar={toggleStar}
                      onComplete={toggleComplete}
                      onTaskDelete={deleteTask}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </main>

      {/* ═══ AI MIND DRAWER (All Users) ═══ */}
      {isMindOpen && (
        <>
          <div className="mind-backdrop" onClick={() => setIsMindOpen(false)} />
          <div className="mind-drawer">
            <div className="mind-header">
              <h2>🧠 AI Mind Center</h2>
              <button className="mind-close-btn" onClick={() => setIsMindOpen(false)}><X size={16} /></button>
            </div>

            {userSettings?.user_profile && (
              <div className="mind-profile-card">
                <div className="label">Current Cognitive Profile</div>
                <p>{userSettings.user_profile.length > 180 ? userSettings.user_profile.substring(0, 180) + '...' : userSettings.user_profile}</p>
                <div className="mind-categories">
                  {(userSettings.categories || []).map(c => <span key={c} className="mind-cat-chip">{c}</span>)}
                </div>
              </div>
            )}

            <div className="mind-chat" ref={mindChatRef}>
              {mindChat.map((m, i) => <div key={i} className={`chat-bubble ${m.sender}`}>{m.text}</div>)}
              {mindLoading && <div className="typing-dots"><span /><span /><span /></div>}
            </div>

            <div className="quick-chips">
              {['Track my boss\'s emails', 'Merge categories', 'Filter newsletters', 'Add new category'].map(chip => (
                <button key={chip} className="quick-chip" onClick={() => setMindInput(chip)}>{chip}</button>
              ))}
            </div>

            <div className="mind-input-bar">
              <input
                className="mind-input"
                value={mindInput}
                onChange={e => setMindInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleMindChat()}
                placeholder="Prompt your AI companion..."
                disabled={mindLoading}
              />
              <button className="mind-send-btn" onClick={handleMindChat} disabled={mindLoading || !mindInput.trim()}>
                <Send size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══ ONBOARDING OVERLAY (New Users) ═══ */}
      {showOnboarding && (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <h1>Welcome to Tasker AI</h1>
            <p className="subtitle">Let's calibrate your personal AI mind in 3 quick steps</p>

            {synthesizing ? (
              <div className="synthesis-loading">
                <div className="synthesis-orb" />
                <p className="synthesis-status">{synthesisStatus}</p>
              </div>
            ) : (
              <>
                <div className="onboarding-chat-area" ref={onboardingChatRef}>
                  {onboardingChat.map((m, i) => <div key={i} className={`chat-bubble ${m.sender}`}>{m.text}</div>)}
                </div>

                <div className="quick-chips">
                  {onboardingStep === 0 && ['I\'m a student', 'I\'m a developer', 'I\'m a freelancer', 'I manage a team'].map(c => (
                    <button key={c} className="quick-chip" onClick={() => setOnboardingInput(prev => prev ? prev + ', ' + c.toLowerCase() : c)}>{c}</button>
                  ))}
                  {onboardingStep === 1 && ['GitHub notifications', 'Client invoices', 'Newsletters', 'Server alerts', 'Marketing emails'].map(c => (
                    <button key={c} className="quick-chip" onClick={() => setOnboardingInput(prev => prev ? prev + ', ' + c.toLowerCase() : c)}>{c}</button>
                  ))}
                  {onboardingStep === 2 && ['Bills with deadlines', 'Meeting invites', 'Boss emails', 'Assignment deadlines', 'Track everything'].map(c => (
                    <button key={c} className="quick-chip" onClick={() => setOnboardingInput(prev => prev ? prev + ', ' + c.toLowerCase() : c)}>{c}</button>
                  ))}
                </div>

                <div className="onboarding-input-area">
                  <input
                    className="onboarding-input"
                    value={onboardingInput}
                    onChange={e => setOnboardingInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleOnboardingSubmit()}
                    placeholder={onboardingStep === 0 ? 'Tell me about yourself...' : onboardingStep === 1 ? 'Describe your inbox...' : 'What tasks matter to you...'}
                  />
                  <button className="onboarding-send" onClick={handleOnboardingSubmit} disabled={!onboardingInput.trim() || synthesizing}>
                    {onboardingStep < 2 ? 'Next →' : 'Launch AI ✨'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onToggleStar, onComplete, onTaskDelete }) {
  const [expanded, setExpanded] = useState(false);
  const urgency = getUrgencyLevel(task.deadline);

  return (
    <div
      className={`task-card ${expanded ? 'expanded' : ''} urgency-${urgency.toLowerCase()}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="task-main">
        <div className="task-content">
          <div className="task-header-row">
            <h3 className="task-title">{task.title}</h3>
            {task.course && <span className="course-badge">{task.course}</span>}
          </div>
          <div className="task-meta">
            <span className={`task-deadline`}>{formatDeadline(task.deadline, task.end_time)}</span>
            {task.warnings?.length > 0 && <span className="warning-badge">⚠️</span>}
            {task.updated && <span className="update-badge" title={task.change_note}>🔄</span>}
          </div>
        </div>

        <div className="task-actions" onClick={e => e.stopPropagation()}>
          <button
            className={`action-btn star-btn ${task.starred ? 'active' : ''}`}
            onClick={(e) => onToggleStar(e, task)}
            title={task.starred ? "Unstar" : "Star to prevent fading"}
          >
            <Star fill={task.starred ? "currentColor" : "none"} size={18} />
          </button>
          <button
            className="action-btn delete-btn"
            onClick={(e) => onTaskDelete(e, task)}
            title="Delete task"
          >
            <Trash2 size={18} />
          </button>
          <button
            className="action-btn complete-btn"
            onClick={(e) => onComplete(e, task)}
            title="Mark complete"
          >
            <div className="check-circle" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="task-details">
          <p>{task.summary || 'No summary available.'}</p>
          {task.location && <p className="location">📍 {task.location}</p>}
          {task.source_email_id && (
            <a
              href={`https://mail.google.com/mail/u/0/#inbox/${task.source_email_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="email-link"
              onClick={e => e.stopPropagation()}
            >
              Open in Gmail <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
