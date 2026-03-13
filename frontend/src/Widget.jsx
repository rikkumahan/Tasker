import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { format, differenceInDays, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

function getUrgencyLevel(deadline) {
  if (!deadline) return 'GREEN';
  const d = new Date(deadline.replace('Z', ''));
  if (isPast(d) && !isToday(d)) return 'RED';
  if (isToday(d)) return 'RED';
  if (differenceInDays(startOfDay(d), startOfDay(new Date())) <= 2) return 'YELLOW';
  return 'GREEN';
}

const URGENCY_COLORS = { RED: '#ff4d6d', YELLOW: '#ffd166', GREEN: '#06d6a0' };

export default function Widget() {
  const [topTasks, setTopTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadTasks(session);
      else setLoading(false);
    });
  }, []);

  const loadTasks = async (sess) => {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, deadline, category, starred')
      .eq('user_id', sess.user.id)
      .eq('status', 'pending')
      .not('deadline', 'is', null)
      .order('deadline', { ascending: true })
      .limit(5);

    if (data) {
      // Filter to only RED/YELLOW — no GREEN clutter
      const urgent = data.filter(t => getUrgencyLevel(t.deadline) !== 'GREEN');
      setTopTasks(urgent.slice(0, 3));
    }
    setLoading(false);
  };

  // Phase 9: Badging API — set badge count on icon
  useEffect(() => {
    if ('setAppBadge' in navigator) {
      navigator.setAppBadge(topTasks.length).catch(() => {});
    }
  }, [topTasks]);

  if (!session) {
    return (
      <div style={styles.container}>
        <p style={styles.empty}>Sign in to Tasker AI to see your tasks.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.empty}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>⚡ Tasker</span>
        <span style={styles.subtitle}>{format(new Date(), 'EEE, MMM d')}</span>
      </div>

      {topTasks.length === 0 ? (
        <p style={styles.empty}>🎉 No urgent tasks! You're all caught up.</p>
      ) : (
        <div style={styles.taskList}>
          {topTasks.map(task => {
            const urgency = getUrgencyLevel(task.deadline);
            const d = new Date(task.deadline.replace('Z', ''));
            const label = isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : format(d, 'MMM d');
            return (
              <div key={task.id} style={styles.taskCard}>
                <div style={{ ...styles.urgencyDot, background: URGENCY_COLORS[urgency] }} />
                <div style={styles.taskInfo}>
                  <span style={styles.taskTitle}>{task.title}</span>
                  <span style={{ ...styles.taskDeadline, color: URGENCY_COLORS[urgency] }}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <a href="/" style={styles.openLink}>Open Full Dashboard →</a>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 100%)',
    display: 'flex',
    flexDirection: 'column',
    padding: '1.25rem',
    fontFamily: "'Inter', sans-serif",
    color: '#e0e0f0',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
    background: 'linear-gradient(90deg, #4fc3f7, #06d6a0)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '0.72rem',
    color: 'rgba(255,255,255,0.4)',
  },
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    flex: 1,
  },
  taskCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(10px)',
    borderRadius: '10px',
    padding: '0.6rem 0.8rem',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  urgencyDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  taskInfo: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  taskTitle: {
    fontSize: '0.82rem',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskDeadline: {
    fontSize: '0.68rem',
    fontWeight: '500',
    marginTop: '2px',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.85rem',
    textAlign: 'center',
    marginTop: '2rem',
  },
  openLink: {
    color: '#4fc3f7',
    fontSize: '0.75rem',
    textAlign: 'center',
    textDecoration: 'none',
    marginTop: '1rem',
    opacity: 0.7,
  },
};
