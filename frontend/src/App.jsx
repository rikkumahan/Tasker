import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { differenceInDays, isPast, isToday, isTomorrow, format, startOfDay } from 'date-fns';
import { ChevronDown, ChevronRight, Star, ExternalLink, RefreshCw } from 'lucide-react';
import './index.css';

// Initialize Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

function getUrgencyLevel(deadline) {
  if (!deadline) return 'GREEN';
  const target = startOfDay(new Date(deadline));
  const today = startOfDay(new Date());

  if (isPast(new Date(deadline)) || isToday(new Date(deadline))) {
    return 'RED';
  }

  const diff = differenceInDays(target, today);
  if (diff <= 3) {
    return 'YELLOW';
  }

  return 'GREEN';
}

function formatDeadline(iso) {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  const timeStr = format(d, 'h:mm a');

  if (isPast(d) && !isToday(d)) return `Overdue`;
  if (isToday(d)) return `Today ${timeStr}`;
  if (isTomorrow(d)) return `Tomorrow ${timeStr}`;

  const diffDays = differenceInDays(startOfDay(d), startOfDay(new Date()));
  if (diffDays < 7) return `${format(d, 'EEE')} ${timeStr}`;
  return `${format(d, 'MMM d')} ${timeStr}`;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({});

  useEffect(() => {
    fetchTasks();

    // Realtime subscription
    let channel = null;
    if (supabase) {
      channel = supabase
        .channel('tasks-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
          fetchTasks();
        })
        .subscribe();
    }

    return () => {
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const fetchTasks = async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('deadline', { ascending: true, nullsFirst: false });

    if (!error && data) {
      setTasks(data);
    }
    setLoading(false);
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      // Hit the Vercel backend to trigger the GitHub Action securely
      const response = await fetch('/api/sync', { method: 'POST' });

      if (response.ok) {
        // The action takes time to run emails, poll for new data after 5 seconds
        setTimeout(fetchTasks, 5000);
      } else {
        console.error("Failed to trigger API sync");
        await fetchTasks();
      }
    } catch (e) {
      console.error(e);
      await fetchTasks();
    }
    setTimeout(() => setSyncing(false), 2000);
  };

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

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-info">
          <h1>My Tasks</h1>
          <p>{format(new Date(), 'EEEE, MMMM do')}</p>
        </div>
        <button
          onClick={handleManualSync}
          className={`sync-btn ${syncing ? 'spinning' : ''}`}
          disabled={syncing || !supabase}
        >
          <RefreshCw size={20} />
        </button>
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
            <span className={`task-deadline`}>{formatDeadline(task.deadline)}</span>
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
