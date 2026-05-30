import React, { useState, useEffect, useRef } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const URGENCY_CLASS = { URGENT: 'db-badge-urgent', HIGH: 'db-badge-high', MEDIUM: 'db-badge-medium', LOW: 'db-badge-low' };

const GmailIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z"/>
    <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z"/>
    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,30.45 35,23.7 36,17"/>
    <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.203 8.228 7.837 7.258 7.837 4.908 7.837 3 9.745 3 12.298z"/>
    <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C39.868 8.203 40.772 7.837 41.742 7.837 44.092 7.837 45 9.745 45 12.298z"/>
  </svg>
);

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Normalise action_items: Supabase JSONB may return string[] or {text:string}[] or {task:string, assignee:string}[]
function normaliseItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (typeof item === 'string') return item;
    if (item?.task) return item.assignee ? `${item.task} (Assignee: ${item.assignee})` : item.task;
    return item?.text || JSON.stringify(item);
  });
}

const TABS = ['summary', 'email', 'context'];

export default function TaskDetail({ thread, session, supabase }) {
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState(null);
  const [activeTab, setActiveTab]         = useState('summary');
  const [expanded, setExpanded]           = useState(false);
  const [copied, setCopied]               = useState(false);
  const [checked, setChecked]             = useState({});
  const [liveEmails, setLiveEmails]       = useState({});
  // Use a ref for in-flight guard so it doesn't retrigger the fetch effect
  const fetchingRef = useRef({});

  useEffect(() => {
    if (!thread?.id) { 
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return; 
    }
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab('summary');
    setExpanded(false);
    setChecked({});
    setLiveEmails({});
    fetchingRef.current = {};

    supabase.functions.invoke('api/thread-detail', {
      body: { thread_id: thread.id },
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    }).then(({ data, error }) => {
      if (error) throw error;
      setDetail(data);
    }).catch(e => {
      console.error('[TaskDetail] fetch error:', e);
      setDetailError(e.message || 'Could not load thread details. Please try again.');
    }).finally(() => setDetailLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, session]);

  useEffect(() => {
    if (activeTab === 'email' && detail?.emails?.length > 0) {
      detail.emails.forEach(email => {
        if (!liveEmails[email.id] && !fetchingRef.current[email.id] && email.message_id) {
          fetchingRef.current[email.id] = true;
          supabase.functions.invoke('api/raw-email', {
            body: { message_id: email.message_id },
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${session.access_token}`,
            }
          }).then(({ data, error }) => {
            if (error) throw error;
            setLiveEmails(prev => ({ ...prev, [email.id]: data.body }));
          }).catch(e => {
            console.error('[TaskDetail] Failed to fetch raw email:', e);
            setLiveEmails(prev => ({ ...prev, [email.id]: email.body || '(Could not load email)' }));
          }).finally(() => {
            fetchingRef.current[email.id] = false;
          });
        }
      });
    }
  // fetchingRef is a stable ref, liveEmails setter is stable — only retrigger on tab/emails change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, detail?.emails, session]);

  const handleCopy = () => {
    const reply = detail?.thread?.suggested_reply;
    if (!reply) return;
    navigator.clipboard.writeText(reply).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Empty state
  if (!thread) {
    return (
      <div className="db-detail-col db-detail-empty">
        <div className="db-detail-empty-icon">📬</div>
        <div className="db-detail-empty-title">Select a thread to view details</div>
      </div>
    );
  }

  // Merge thread-list data with fully-fetched detail (detail wins)
  const t          = detail?.thread || thread;
  const actionItems = normaliseItems(t.action_items);
  const emails      = detail?.emails || [];
  const edges       = detail?.context?.edges || [];

  return (
    <div className="db-detail-col">
      {/* ── Header ── */}
      <div className="db-detail-header">
        <div className="db-detail-title-row">
          <div className="db-detail-icon"><GmailIcon size={20} /></div>
          <div className="db-detail-title-group">
            <div className="db-detail-subject">
              {t.subject || '(no subject)'}
              {t.urgency && t.urgency !== 'LOW' && (
                <span className={`db-badge db-badge-sm ${URGENCY_CLASS[t.urgency] || ''}`}>
                  {t.urgency}
                </span>
              )}
            </div>
            <div className="db-detail-meta">
              <span>{t.sender_name || 'Unknown'}</span>
              {t.sender_email && (
                <span className="db-detail-meta-email">· {t.sender_email}</span>
              )}
              <span className="db-detail-meta-time">{timeAgo(t.created_at)}</span>
            </div>
          </div>
          {t.gmail_url && (
            <a
              href={t.gmail_url}
              target="_blank"
              rel="noopener noreferrer"
              className="db-gmail-link"
              title="Open in Gmail"
            >
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="db-detail-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`db-detail-tab${activeTab === tab ? ' db-detail-tab-on' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="db-detail-body">
        {detailLoading ? (
          <div className="db-detail-loading">
            <span className="db-spinner" /> Loading thread details...
          </div>
        ) : detailError ? (
          <div className="db-detail-error">{detailError}</div>
        ) : activeTab === 'summary' ? (
          <>
            {/* AI Summary */}
            <div className="db-detail-section">
              <div className="db-detail-section-title">✦ AI Summary</div>
              {t.ai_summary ? (
                <>
                  <div className={`db-summary-text${expanded ? ' db-summary-expanded' : ''}`}>
                    {t.ai_summary}
                  </div>
                  {t.ai_summary.length > 200 && (
                    <button className="db-show-more" onClick={() => setExpanded(e => !e)}>
                      {expanded ? 'Show less ↑' : 'Show more ↓'}
                    </button>
                  )}
                </>
              ) : (
                <div className="db-summary-empty">Summary not yet generated.</div>
              )}
            </div>

            {/* Action Items */}
            <div className="db-detail-section">
              <div className="db-detail-section-title">Action Items</div>
              {actionItems.length === 0 ? (
                <div className="db-summary-empty">No action items extracted.</div>
              ) : (
                <div className="db-action-items">
                  {actionItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="db-action-item"
                      onClick={() => setChecked(prev => ({ ...prev, [idx]: !prev[idx] }))}
                    >
                      <div className={`db-cb${checked[idx] ? ' db-cb-on' : ''}`}>
                        {checked[idx] && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8"
                              strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span className={checked[idx] ? 'db-item-done' : ''}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Suggested Reply */}
            {t.suggested_reply && (
              <div className="db-detail-section">
                <div className="db-detail-section-title-row">
                  <span className="db-detail-section-title">✦ Suggested Reply</span>
                  <button className="db-use-reply-btn" onClick={handleCopy}>
                    {copied
                      ? <><Check size={13}/> Copied!</>
                      : <><Copy size={13}/> Use Reply</>}
                  </button>
                </div>
                <div className="db-suggested-reply">{t.suggested_reply}</div>
              </div>
            )}
          </>
        ) : activeTab === 'email' ? (
          <div className="db-email-tab">
            {emails.length === 0 ? (
              <div className="db-summary-empty">No email content stored yet.</div>
            ) : (
              emails.map((email, idx) => (
                <div key={idx} className="db-email-msg">
                  <div className="db-email-msg-header">
                    <span className="db-email-from">
                      {email.sender_name || email.sender_email || 'Unknown'}
                    </span>
                    <span className="db-email-msg-time">
                      {email.received_at
                        ? new Date(email.received_at).toLocaleString([], {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>
                  <div className="db-email-body">
                    {fetchingEmails[email.id] && !liveEmails[email.id] 
                      ? <span className="db-spinner" style={{width: 14, height: 14, borderWidth: 1.5}}></span>
                      : (liveEmails[email.id] || email.body || '(no body)')}
                  </div>
                </div>
              ))
            )}
            {t.gmail_url && (
              <a href={t.gmail_url} target="_blank" rel="noopener noreferrer" className="db-gmail-link-btn">
                Open in Gmail <ExternalLink size={13} />
              </a>
            )}
          </div>
        ) : (
          /* Context tab */
          <div className="db-context-tab">
            {edges.length === 0 ? (
              <div className="db-summary-empty">No context graph data available.</div>
            ) : (
              edges.map((edge, idx) => (
                <div key={idx} className="db-edge-row">
                  <span className="db-edge-type">{edge.relationship_type}</span>
                  <span className="db-edge-desc">{edge.description}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
