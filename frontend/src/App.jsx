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
          bootstrapUser(newSession);
        } else {
          fetchTasks(newSession);
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
      .select('last_synced_at, last_sync_triggered_at, user_profile, categories, last_sync_error, secrets, gmail_email')
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

  const bootstrapUser = async (sess) => {
    if (onboardingTriggeredRef.current) {
      console.log('[INFO] Bootstrapping already triggered, skipping duplicate call.');
      return;
    }
    onboardingTriggeredRef.current = true;
    setLoading(true);
    try {
        console.log('[INFO] Bootstrapping new user settings and registering push...');
        const providerToken = sess?.provider_token;
        const providerRefreshToken = sess?.provider_refresh_token;
        
        // Create settings and register webhooks
        await triggerSync(sess, null, { providerToken, providerRefreshToken, bootstrap_only: true });
        
        // Immediately run first full sync to pull emails and actions!
        console.log('[INFO] Starting first full sync...');
        await triggerSync(sess);
        await fetchTasks(sess);
    } catch (e) {
        console.error("Bootstrap error", e);
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
  }, [onboardingChat, onboardingChatLoading]);

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

  const impactScore = { 'high': 3, 'medium': 2, 'low': 1, null: 0, undefined: 0 };

  const grouped = pendingTasks.reduce((acc, task) => {
    // Group by sender_organization if available, else fallback to category
    const cat = task.sender_organization || task.category || 'uncategorized';
    if (!acc[cat]) {
      acc[cat] = { tasks: [], urgency: { RED: 0, YELLOW: 0, GREEN: 0 }, impactScore: 0 };
    }

    const u = getUrgencyLevel(task.deadline);
    acc[cat].tasks.push(task);
    acc[cat].urgency[u]++;
    acc[cat].impactScore += impactScore[task.impact_level] || 0;

    return acc;
  }, {});

  // Sort tasks within each group by impact level (High > Medium > Low)
  Object.keys(grouped).forEach(cat => {
    grouped[cat].tasks.sort((a, b) => {
      const scoreA = impactScore[a.impact_level] || 0;
      const scoreB = impactScore[b.impact_level] || 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      // fallback to deadline sorting
      if (a.deadline && b.deadline) {
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });
  });

  // Sort categories by aggregate impact score and urgency
  const categoryKeys = Object.keys(grouped).sort((a, b) => {
    const aIsCheckOut = a === 'Check_Out_Mail';
    const bIsCheckOut = b === 'Check_Out_Mail';

    if (aIsCheckOut && !bIsCheckOut) return 1;
    if (!aIsCheckOut && bIsCheckOut) return -1;

    if (grouped[a].impactScore !== grouped[b].impactScore) {
      return grouped[b].impactScore - grouped[a].impactScore;
    }

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
            <div className="header-info" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <img src="/icons/logo.png" alt="Tasker AI Logo" className="app-header-logo" />
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>My Tasks</h1>
                <p className="date-display" style={{ margin: 0 }}>{format(new Date(), 'EEEE, MMMM do')}</p>
                {userSettings?.user_profile && (
                  <p className="profile-subheadline" title={userSettings.user_profile} style={{ margin: '0.1rem 0 0' }}>
                    {userSettings.user_profile.length > 100 
                      ? `${userSettings.user_profile.substring(0, 100)}...` 
                      : userSettings.user_profile}
                  </p>
                )}
              </div>
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
                    <ActionCard
                      key={task.id}
                      task={task}
                      onToggleStar={toggleStar}
                      onComplete={toggleComplete}
                      onTaskDelete={deleteTask}
                      gmailEmail={userSettings?.gmail_email}
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




    </div>
  );
}

function ActionCard({ task, onToggleStar, onComplete, onTaskDelete, gmailEmail }) {
  const [expanded, setExpanded] = useState(false);
  const urgency = getUrgencyLevel(task.deadline);

  return (
    <div
      className={`task-card ${expanded ? 'expanded' : ''} urgency-${urgency.toLowerCase()}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="task-main">
        <div className="task-content">
          <div className="task-header-row" style={{ flexWrap: 'wrap' }}>
            {task.action_type && (
              <span className={`action-chip ${task.action_type}`}>
                {task.action_type.replace('_', ' ')}
              </span>
            )}
            <h3 className="task-title" style={{ display: 'inline-block', marginRight: '8px' }}>
              {task.title}
            </h3>
            {task.impact_level && (
              <span className={`impact-badge ${task.impact_level}`}>
                {task.impact_level} Impact
              </span>
            )}
            {task.sender_organization && (
              <span className="sender-org">🏢 {task.sender_organization}</span>
            )}
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
            title="Delete action"
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
          
          {task.escalation_risk && (
            <div className="escalation-risk-banner">
              <strong>Escalation Risk:</strong> {task.escalation_risk}
            </div>
          )}

          {task.suggested_reply_draft?.options && (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {task.suggested_reply_draft.options.map((opt, i) => (
                <button 
                  key={i} 
                  className="mind-send-btn" 
                  style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
                  onClick={(e) => {
                     e.stopPropagation();
                     navigator.clipboard.writeText(opt.text);
                     alert("Draft copied to clipboard!");
                  }}
                  title="Copy draft to clipboard"
                >
                  📝 {opt.label}
                </button>
              ))}
            </div>
          )}

          {task.source_email_id && (
            <a
              href={gmailEmail 
                ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(gmailEmail)}#all/${task.source_email_id}`
                : `https://mail.google.com/mail/u/0/#all/${task.source_email_id}`
              }
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
