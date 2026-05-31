import React, { useRef, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bell, Search, X, SlidersHorizontal } from 'lucide-react';

// Inline Gmail icon — no external dependency
const GmailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z"/>
    <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z"/>
    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,30.45 35,23.7 36,17"/>
    <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.203 8.228 7.837 7.258 7.837 4.908 7.837 3 9.745 3 12.298z"/>
    <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C39.868 8.203 40.772 7.837 41.742 7.837 44.092 7.837 45 9.745 45 12.298z"/>
  </svg>
);

const URGENCY_DOT   = { URGENT: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', LOW: '#d1d5db' };
const URGENCY_CLASS = { URGENT: 'db-badge-urgent', HIGH: 'db-badge-high', MEDIUM: 'db-badge-medium', LOW: 'db-badge-low' };
const ACTION_LABEL  = { reply: 'Reply', approve: 'Approve', review: 'Review', join: 'Join', view: 'View' };

const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'action',    label: 'Action' },
  { key: 'waiting',   label: 'Waiting' },
  { key: 'important', label: 'Important' },
  { key: 'unread',    label: 'Unread' },
];

function timeAgo(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: false })
      .replace('about ', '')
      .replace(' minutes', 'm').replace(' minute', 'm')
      .replace(' hours', 'h').replace(' hour', 'h')
      .replace(' days', 'd').replace(' day', 'd');
  } catch { return ''; }
}

export default function TaskList({
  threads, loading, selectedThread, activeFilter,
  onSelectThread, onFilterChange, onLoadMore, session,
}) {
  const listRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');

  const firstName =
    session?.user?.user_metadata?.full_name?.split(' ')?.[0] ||
    session?.user?.email?.split('@')?.[0] ||
    'there';

  // Derived counts from loaded threads (no extra query) — always from raw threads
  const counts = {
    all:       threads.length,
    action:    threads.filter(t => ['reply','approve','review','join'].includes(t.action_type)).length,
    waiting:   threads.filter(t => !t.action_type || t.action_type === 'view').length,
    important: threads.filter(t => t.urgency === 'URGENT' || t.urgency === 'HIGH').length,
    unread:    threads.filter(t => !t.is_read).length,
  };

  const filteredThreads = searchQuery.trim()
    ? threads.filter(t => {
        const q = searchQuery.toLowerCase();
        return (
          (t.subject || '').toLowerCase().includes(q) ||
          (t.sender_name || '').toLowerCase().includes(q) ||
          (t.sender_email || '').toLowerCase().includes(q)
        );
      })
    : threads;

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        onLoadMore();
      }
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onLoadMore]);

  return (
    <div className="db-list-col">
      {/* Header */}
      <div className="db-list-header">
        <div className="db-list-header-row">
          <div>
            <h2 className="db-greeting-title">Hello, {firstName}!</h2>
            <p className="db-greeting-sub">Here's what needs your attention today.</p>
          </div>
          <button className="db-bell-btn" title="Notifications">
            <Bell size={18} />
          </button>
        </div>
        <div className="db-search-wrap">
          <Search size={14} className="db-search-icon" />
          <input
            className="db-search-input"
            type="text"
            placeholder="Search threads..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="db-search-clear" onClick={() => setSearchQuery('')}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="db-filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`db-filter-tab${activeFilter === f.key ? ' db-filter-tab-on' : ''}`}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
            {counts[f.key] > 0 && (
              <span className="db-filter-count">{counts[f.key]}</span>
            )}
          </button>
        ))}
        <button className="db-filter-more-btn" title="Advanced filters">
          <SlidersHorizontal size={13} /> Filter
        </button>
      </div>

      {/* Thread rows */}
      <div className="db-thread-list" ref={listRef}>
        {loading ? (
          <div className="db-loading-row">
            <span className="db-spinner" />
            <span>Loading your inbox...</span>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="db-empty-state">
            {searchQuery ? (
              <>
                <div className="db-empty-icon">🔍</div>
                <div className="db-empty-title">No results for "{searchQuery}"</div>
                <div className="db-empty-sub">Try a different search term.</div>
              </>
            ) : (
              <>
                <div className="db-empty-icon">🎉</div>
                <div className="db-empty-title">You're all caught up!</div>
                <div className="db-empty-sub">We'll notify you when something important comes in.</div>
              </>
            )}
          </div>
        ) : (
          filteredThreads.map(t => (
            <div
              key={t.id}
              className={[
                'db-thread-row',
                selectedThread?.id === t.id ? 'db-thread-row-on' : '',
                !t.is_read ? 'db-thread-row-unread' : '',
              ].join(' ').trim()}
              onClick={() => onSelectThread(t)}
            >
              <span
                className="db-urgency-dot"
                style={{ background: URGENCY_DOT[t.urgency] || URGENCY_DOT.LOW }}
              />
              <div className="db-thread-icon"><GmailIcon /></div>
              <div className="db-thread-body">
                <div className="db-thread-top">
                  <span className="db-thread-subject">{t.subject || '(no subject)'}</span>
                  <span className="db-thread-time">{timeAgo(t.created_at)}</span>
                </div>
                <div className="db-thread-bottom">
                  <span className="db-thread-sender">{t.sender_name || 'Unknown'}</span>
                  {t.urgency && t.urgency !== 'LOW' && (
                    <span className={`db-badge ${URGENCY_CLASS[t.urgency] || ''}`}>
                      {t.urgency}
                    </span>
                  )}
                  <button
                    className="db-action-btn"
                    onClick={e => { e.stopPropagation(); onSelectThread(t); }}
                  >
                    {ACTION_LABEL[t.action_type] || 'View'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
