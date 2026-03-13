import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { differenceInDays, isPast, isToday, isTomorrow, format, startOfDay } from 'date-fns';
import { ChevronDown, ChevronRight, Star, ExternalLink, RefreshCw, LogOut } from 'lucide-react';
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
  const [syncCountdown, setSyncCountdown] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [userSettings, setUserSettings] = useState(null);

  // BUG FIX 1: Store session in a ref so the realtime listener closure always sees the latest value
  const sessionRef = React.useRef(null);
  // BUG FIX 2: Single timer ref — prevents stacking intervals if triggerSync is called rapidly
  const countdownRef = React.useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session;
      setSession(session);
      if (session) fetchTasks(session);
    });

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      sessionRef.current = newSession;
      setSession(newSession);
      if (newSession) {
        // BUG FIX 3: Only onboard on true first-time SIGNED_IN, not on session restores.
        // Session restores fire SIGNED_IN too, but provider_token is null for restores.
        if (_event === 'SIGNED_IN' && newSession.provider_token) {
          handleOnboarding(newSession);
        }
        fetchTasks(newSession);
      } else {
        setTasks([]);
      }
    });

    // Realtime subscription — BUG FIX 1: use sessionRef so the closure is never stale
    let channel = null;
    if (supabase) {
      channel = supabase
        .channel('tasks-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
          if (sessionRef.current) fetchTasks(sessionRef.current);
        })
        .subscribe();
    }

    return () => {
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, []);

  const fetchTasks = async (sess) => {
    const activeSess = sess || sessionRef.current;
    if (!supabase || !activeSess) { setLoading(false); return; }
    setLoading(true);

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', activeSess.user.id)
      .order('deadline', { ascending: true, nullsFirst: false });
    if (!error && data) setTasks(data);

    // Fetch user settings for synced time + trigger lock
    const { data: settingsData } = await supabase
      .from('user_settings')
      .select('last_synced_at, last_sync_triggered_at')
      .eq('user_id', activeSess.user.id)
      .single();

    if (settingsData) {
      setUserSettings(settingsData);

      // BUG FIX 4: Pass settingsData directly to triggerSync — avoids stale userSettings state
      const lastSync = settingsData.last_synced_at;
      if (lastSync) {
        const minsAgo = (Date.now() - new Date(lastSync).getTime()) / 60000;
        if (minsAgo > 30) {
          console.log('[INFO] Data stale (> 30 min). Triggering silent background sync.');
          triggerSync(activeSess, settingsData);
        }
      }
    }
    setLoading(false);
  };

  const handleOnboarding = async (sess) => {
    setLoading(true);
    try {
        const providerToken = sess?.provider_token;
        const providerRefreshToken = sess?.provider_refresh_token;
        
        // Pass tokens to our onboard function in standard VITE API route
        const res = await fetch('/api/onboard', {
           method: 'POST',
           headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${sess.access_token}`
           },
           body: JSON.stringify({ providerToken, providerRefreshToken })
        });
        
        if (!res.ok) {
           console.error("Onboarding failed", await res.text());
        }
    } catch (e) {
        console.error("Onboarding error", e);
    }
    setLoading(false);
  };

  // Core sync trigger — shared by button AND auto-stale check
  // BUG FIX 4: Accept freshSettings param so it never reads stale React state
  const triggerSync = async (sess, freshSettings) => {
    const activeSess = sess || sessionRef.current;
    if (!activeSess) return;

    // 60-second debounce lock — use freshSettings if provided, else fall back to state
    const settings = freshSettings || userSettings;
    if (settings?.last_sync_triggered_at) {
      const secsAgo = (Date.now() - new Date(settings.last_sync_triggered_at).getTime()) / 1000;
      if (secsAgo < 60) {
        console.log('[INFO] Sync locked — triggered recently. Skipping.');
        return;
      }
    }

    // BUG FIX 2: Clear any existing timer before starting a new one
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    setSyncing(true);
    let count = 90;
    setSyncCountdown(count);
    countdownRef.current = setInterval(() => {
      count -= 1;
      setSyncCountdown(count);
      if (count <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }, 1000);

    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeSess.access_token}` }
      });
      setTimeout(() => fetchTasks(activeSess), 45000);
    } catch (e) {
      console.error('Sync trigger error:', e);
    }

    setTimeout(() => {
      setSyncing(false);
      setSyncCountdown(0);
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    }, 92000);
  };

  const handleManualSync = () => triggerSync();

  const toggleStar = async (e, task) => {
    e.stopPropagation();
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, starred: !t.starred } : t));
    await supabase.from('tasks').update({ starred: !task.starred }).eq('id', task.id);
  };

  const toggleComplete = async (e, task) => {
    e.stopPropagation();
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed' } : t));
    await supabase.from('tasks').update({ status: 'completed' }).eq('id', task.id);
  };

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Filter & Group tasks
  const pendingTasks = tasks.filter(t => {
    if (t.status === 'completed') return false;

    // 24hr auto-fade policy for non-deadlined items (except the special Check Out Mail category)
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
          <p>{format(new Date(), 'EEEE, MMMM do')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {syncCountdown > 0 ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--yellow-color)', fontWeight: '600' }}>
              ⚡ Syncing... {syncCountdown}s
            </span>
          ) : userSettings?.last_synced_at && (
            <span className="last-synced-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Last synced: {format(new Date(userSettings.last_synced_at), 'h:mm a')}
            </span>
          )}
          <button
            onClick={handleManualSync}
            className={`sync-btn ${syncing ? 'spinning' : ''}`}
            disabled={syncing || !supabase || syncCountdown > 0}
            title={syncCountdown > 0 ? `Sync in progress (${syncCountdown}s)` : 'Refresh Inbox'}
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
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}

function TaskCard({ task, onToggleStar, onComplete }) {
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
