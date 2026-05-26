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
  const [showMindToast, setShowMindToast] = useState(false);
  const [onboardingChat, setOnboardingChat] = useState([]);
  const [onboardingInput, setOnboardingInput] = useState('');
  const [onboardingChatLoading, setOnboardingChatLoading] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesisStatus, setSynthesisStatus] = useState('');

  // ── Wizard State (replaces chat onboarding for new users) ──
  const [wizardStep, setWizardStep] = useState(null); // null | 2 | 3 | 4 | 'progress'
  const [wizardFlags, setWizardFlags] = useState({
    lookbackDays: 30,
    trackingPrefs: ['tasks', 'deadlines', 'people', 'projects'],
    gmailLabels: ['IMPORTANT', 'INBOX'],
    customLabelIds: [],
    otherText: '',
    useCustomLabels: false,
  });
  const [availableLabels, setAvailableLabels] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState({ threads_total: 0, threads_done: 0, eta_seconds: 0, queue_position: 0 });
  const onboardingChatRef = React.useRef(null);
  const mindChatRef = React.useRef(null);

  // ── GraphRAG & Directory State ──
  const [activeTab, setActiveTab] = useState('tasks'); // 'tasks' | 'graph' | 'directory'
  const [directorySubTab, setDirectorySubTab] = useState('contacts'); // 'contacts' | 'projects'
  const [searchMode, setSearchMode] = useState('local'); // 'local' | 'global'
  const [graphMessages, setGraphMessages] = useState([]);
  const [graphInput, setGraphInput] = useState('');
  const [graphLoading, setGraphLoading] = useState(false);
  const [activeCitation, setActiveCitation] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [contactsList, setContactsList] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [communitiesList, setCommunitiesList] = useState([]);
  const [directorySearchQuery, setDirectorySearchQuery] = useState('');

  const graphChatRef = React.useRef(null);

  // Store session and intervals in refs so they persist across renders and are accessible in cleanup
  const sessionRef = React.useRef(null);
  const pollRef = React.useRef(null);
  // Debounce refs for Realtime — prevents flicker from rapid-fire DB events during background sync
  const taskDebounceRef = React.useRef(null);
  const settingsDebounceRef = React.useRef(null);
  const initialSyncDoneRef = React.useRef(false); // Guard against recursive sync or onboarding loops
  const onboardingTriggeredRef = React.useRef(false); // Prevent double onboarding from race conditions
  const onboardingPollRef = React.useRef(null);       // Interval ID for onboarding_status polling
  const providerTokenRef = React.useRef(null);         // Stores OAuth tokens during wizard flow

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
      if (onboardingPollRef.current) clearInterval(onboardingPollRef.current);
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

  const fetchDirectoryData = async () => {
    const activeSess = session || sessionRef.current;
    if (!supabase || !activeSess) return;
    setDirectoryLoading(true);

    try {
      const [contactsRes, projectsRes, communitiesRes] = await Promise.all([
        supabase.from('contacts').select('*').order('name', { ascending: true }),
        supabase.from('projects').select('*').order('name', { ascending: true }),
        supabase.from('community_reports').select('*').order('rating', { ascending: false })
      ]);

      if (contactsRes.data) setContactsList(contactsRes.data);
      if (projectsRes.data) setProjectsList(projectsRes.data);
      if (communitiesRes.data) setCommunitiesList(communitiesRes.data);
    } catch (e) {
      console.error('Error fetching directory data:', e);
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'directory') {
      fetchDirectoryData();
    }
  }, [activeTab]);

  const handleGraphQuery = async () => {
    const input = graphInput.trim();
    if (!input || graphLoading) return;

    setGraphInput('');
    setGraphMessages(prev => [...prev, { sender: 'user', text: input }]);
    setGraphLoading(true);

    try {
      const sess = session || sessionRef.current;
      const { data, error } = await supabase.functions.invoke('query', {
        body: { query: input, mode: searchMode },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${sess.access_token}`
        }
      });

      if (error) throw error;

      setGraphMessages(prev => [...prev, {
        sender: 'ai',
        text: data.answer || 'No response received.',
        citations: data.citations || []
      }]);
    } catch (e) {
      console.error('GraphRAG query error:', e);
      setGraphMessages(prev => [...prev, {
        sender: 'ai',
        text: 'An error occurred while querying the graph intelligence engine. Please check your connection and try again.'
      }]);
    } finally {
      setGraphLoading(false);
    }
  };

  const handleQuickQuery = (queryText) => {
    setGraphInput(queryText);
  };

  React.useEffect(() => {
    if (graphChatRef.current) {
      graphChatRef.current.scrollTop = graphChatRef.current.scrollHeight;
    }
  }, [graphMessages, graphLoading]);

  const renderFormattedText = (text, citations) => {
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, lineIdx) => {
      let content = line;
      const isBullet = content.trim().startsWith('- ') || content.trim().startsWith('* ');
      if (isBullet) {
        content = content.trim().substring(2);
      }
      
      const processInline = (str) => {
        const boldParts = str.split('**');
        const formattedParts = [];
        
        boldParts.forEach((part, boldIdx) => {
          const isBold = boldIdx % 2 === 1;
          const parsedCitations = [];
          const citationRegex = /\[Thread:\s*([^\]]+)\]/g;
          let lastIndex = 0;
          let match;
          
          while ((match = citationRegex.exec(part)) !== null) {
            const matchIndex = match.index;
            const subject = match[1].trim();
            
            if (matchIndex > lastIndex) {
              parsedCitations.push(part.substring(lastIndex, matchIndex));
            }
            
            const citation = (citations || []).find(c => c.subject.toLowerCase() === subject.toLowerCase());
            
            if (citation) {
              parsedCitations.push(
                <button
                  key={`citation-${lineIdx}-${boldIdx}-${matchIndex}`}
                  className="citation-badge"
                  onClick={() => setActiveCitation(citation)}
                  title={`Click to view context: ${citation.subject}`}
                >
                  📄 {citation.subject}
                </button>
              );
            } else {
              parsedCitations.push(
                <span key={`citation-fallback-${lineIdx}-${boldIdx}-${matchIndex}`} className="citation-badge fallback" title={subject}>
                  📄 {subject}
                </span>
              );
            }
            
            lastIndex = citationRegex.lastIndex;
          }
          
          if (lastIndex < part.length) {
            parsedCitations.push(part.substring(lastIndex));
          }
          
          const renderedPart = parsedCitations.length > 0 ? parsedCitations : part;
          
          if (isBold) {
            formattedParts.push(<strong key={`bold-${boldIdx}`}>{renderedPart}</strong>);
          } else {
            formattedParts.push(renderedPart);
          }
        });
        
        return formattedParts.length > 0 ? formattedParts : str;
      };
      
      const processedContent = processInline(content);
      
      if (isBullet) {
        return (
          <li key={`line-${lineIdx}`} className="chat-bullet-item" style={{ marginLeft: '1.25rem', listStyleType: 'disc' }}>
            {processedContent}
          </li>
        );
      }
      
      if (line.trim() === '') {
        return <div key={`line-${lineIdx}`} className="chat-paragraph-break" style={{ height: '0.5rem' }} />;
      }
      
      if (line.trim().startsWith('### ')) {
        return <h4 key={`line-${lineIdx}`} className="chat-header-h4" style={{ marginTop: '0.75rem', marginBottom: '0.25rem', color: 'var(--copper-light)' }}>{processInline(line.trim().substring(4))}</h4>;
      }
      if (line.trim().startsWith('## ')) {
        return <h3 key={`line-${lineIdx}`} className="chat-header-h3" style={{ marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--accent)' }}>{processInline(line.trim().substring(3))}</h3>;
      }
      
      return <p key={`line-${lineIdx}`} className="chat-text-paragraph">{processedContent}</p>;
    });
  };

  // Dedicated recovery and freshness checker
  // This runs EXACTLY ONCE on initial app load/auth restore.
  const checkSyncHealth = async (sess) => {
    if (initialSyncDoneRef.current || !sess) return;
    initialSyncDoneRef.current = true;

    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_profile, last_synced_at, onboarding_status, onboarding_progress')
      .eq('user_id', sess.user.id)
      .maybeSingle();

    // Returning user who has an onboarding in flight — resume progress screen
    if (settings?.onboarding_status === 'queued' || settings?.onboarding_status === 'processing') {
      console.log('[INFO] Onboarding in progress, resuming progress screen.');
      if (settings.onboarding_progress) setOnboardingProgress(settings.onboarding_progress);
      setWizardStep('progress');
      startOnboardingPolling(sess);
      return;
    }

    const DEFAULT_PROFILE = "A busy professional seeking to organize their schedule, extract actionable tasks from communications, and manage deadlines efficiently.";
    if (!settings || !settings.user_profile || settings.user_profile === DEFAULT_PROFILE) {
      console.log('[INFO] New user detected. Showing setup wizard...');
      // Store any available OAuth tokens so the wizard's Start Syncing can pass them
      if (sess?.provider_token && !providerTokenRef.current?.providerToken) {
        providerTokenRef.current = {
          providerToken: sess.provider_token,
          providerRefreshToken: sess.provider_refresh_token,
        };
      }
      setWizardStep(2);
    } else if (settings.last_synced_at) {
      console.log(`[INFO] Last sync was ${Math.round((Date.now() - new Date(settings.last_synced_at).getTime()) / 60000)} mins ago.`);
    }
  };

  const bootstrapUser = async (sess) => {
    if (onboardingTriggeredRef.current) {
      console.log('[INFO] Bootstrapping already triggered, skipping duplicate call.');
      return;
    }
    onboardingTriggeredRef.current = true;

    // Store OAuth tokens so the wizard can use them on completion
    providerTokenRef.current = {
      providerToken: sess?.provider_token,
      providerRefreshToken: sess?.provider_refresh_token,
    };

    // Show wizard immediately — no sync call needed yet
    setWizardStep(2);
    await fetchTasks(sess);
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

  // ── WIZARD: Fetch user's Gmail labels for Step 4 label picker ──
  const fetchAvailableLabels = async () => {
    setLabelsLoading(true);
    try {
      const sess = sessionRef.current;
      const { data, error } = await supabase.functions.invoke('labels', {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${sess.access_token}` }
      });
      if (!error && data?.labels) setAvailableLabels(data.labels);
    } catch (e) {
      console.error('[LABELS] Fetch error:', e);
    }
    setLabelsLoading(false);
  };

  // ── WIZARD: Poll onboarding_status every 10s until 'complete' ──
  const startOnboardingPolling = (sess) => {
    if (onboardingPollRef.current) clearInterval(onboardingPollRef.current);
    onboardingPollRef.current = setInterval(async () => {
      const activeSess = sess || sessionRef.current;
      if (!activeSess) return;
      try {
        const { data: settings } = await supabase
          .from('user_settings')
          .select('onboarding_status, onboarding_progress')
          .eq('user_id', activeSess.user.id)
          .maybeSingle();

        if (settings?.onboarding_progress) {
          setOnboardingProgress(settings.onboarding_progress);
        }
        if (settings?.onboarding_status === 'complete') {
          clearInterval(onboardingPollRef.current);
          onboardingPollRef.current = null;
          setWizardStep(null);
          await fetchTasks(activeSess);
        }
      } catch (e) {
        console.error('[POLL] onboarding_status poll error:', e);
      }
    }, 10000); // every 10 seconds
  };

  // ── WIZARD: Called when user clicks "Start Syncing" on Step 4 ──
  const handleWizardComplete = async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    setSyncing(true);
    try {
      const effective = wizardFlags.lookbackDays === -1
        ? (wizardFlags.customDays || 60)
        : wizardFlags.lookbackDays;

      const syncFlags = {
        lookback_days: effective,
        tracking_preferences: [
          ...wizardFlags.trackingPrefs,
          ...(wizardFlags.otherText.trim() ? [wizardFlags.otherText.trim()] : []),
        ],
        gmail_labels: wizardFlags.gmailLabels,
        custom_label_ids: wizardFlags.customLabelIds,
      };

      const tokens = providerTokenRef.current || {};
      const { data, error } = await supabase.functions.invoke('sync', {
        body: {
          ...tokens,
          sync_flags: syncFlags,
          bootstrap_only: true,
        },
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${sess.access_token}` }
      });

      if (error) throw error;

      setOnboardingProgress({
        threads_total: 0,
        threads_done: 0,
        eta_seconds: data?.estimated_total_seconds || 300,
        queue_position: data?.queue_position || 0,
      });
      setWizardStep('progress');
      startOnboardingPolling(sess);
    } catch (e) {
      console.error('[WIZARD] handleWizardComplete error:', e);
    } finally {
      setSyncing(false);
    }
  };

  const handleManualSync = () => triggerSync();

  // ── ONBOARDING DYNAMIC CHAT HANDLER ──
  const handleOnboardingSubmit = async () => {
    const input = onboardingInput.trim();
    if (!input || onboardingChatLoading || synthesizing) return;

    setOnboardingInput('');
    const newUserMessage = { sender: 'user', text: input };
    const updatedChat = [...onboardingChat, newUserMessage];
    
    // Optimistically add user bubble
    setOnboardingChat(updatedChat);
    setOnboardingChatLoading(true);

    try {
      const sess = sessionRef.current;
      const { data, error } = await supabase.functions.invoke('synthesize_profile', {
        body: { mode: 'onboarding', chat_history: updatedChat },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${sess.access_token}`
        }
      });

      if (error) throw error;
      
      const { finished, ai_response } = data;

      if (!finished) {
        // AI needs more information. Add response to chat and continue.
        setOnboardingChat(prev => [...prev, { sender: 'ai', text: ai_response }]);
        setOnboardingChatLoading(false);
      } else {
        // AI is satisfied! Finalize process.
        setOnboardingChat(prev => [...prev, { sender: 'ai', text: ai_response }]);
        setOnboardingChatLoading(false);
        
        // Trigger full synthesis overlay
        setSynthesizing(true);
        setSynthesisStatus('Calibrating extraction filters...');
        await new Promise(r => setTimeout(r, 1200));
        setSynthesisStatus('AI Mind initialized! ⚡');
        await new Promise(r => setTimeout(r, 800));

        // Now trigger the actual first sync
        setShowOnboarding(false);
        setSynthesizing(false);
        await triggerSync(sess);
        await fetchTasks(sess);
      }
    } catch (e) {
      console.error('Synthesis error:', e);
      setOnboardingChatLoading(false);
      setSynthesizing(true);
      setSynthesisStatus('Something went wrong. Proceeding with defaults...');
      await new Promise(r => setTimeout(r, 1500));
      setShowOnboarding(false);
      setSynthesizing(false);
      const sess = sessionRef.current;
      await triggerSync(sess);
      await fetchTasks(sess);
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

  const filteredContacts = contactsList.filter(c => {
    const search = directorySearchQuery.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search) ||
      (c.organization || '').toLowerCase().includes(search) ||
      (c.bio_summary || '').toLowerCase().includes(search)
    );
  });

  const filteredProjects = projectsList.filter(p => {
    const search = directorySearchQuery.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(search) ||
      (p.description || '').toLowerCase().includes(search) ||
      (p.status || '').toLowerCase().includes(search)
    );
  });

  const filteredCommunities = communitiesList.filter(c => {
    const search = directorySearchQuery.toLowerCase();
    return (
      (c.title || '').toLowerCase().includes(search) ||
      (c.summary || '').toLowerCase().includes(search) ||
      (c.rating_explanation || '').toLowerCase().includes(search)
    );
  });

  if (!session) {
    return <Auth supabase={supabase} />
  }

  return (
    <div className="app-container">
      {!showOnboarding && (
        <>
          <header className="app-header">
            <div className="header-info" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <img src="/icons/logo.png" alt="Tasker AI Logo" className="app-header-logo" />
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>Tasker Corporate</h1>
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
                onClick={() => { setShowMindToast(true); setTimeout(() => setShowMindToast(false), 3000); }}
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

          <div className="app-tabs">
            <button
              className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setActiveTab('tasks')}
            >
              📋 Tasks View
            </button>
            <button
              className={`tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
              onClick={() => setActiveTab('graph')}
            >
              🧠 Graph Console
            </button>
            <button
              className={`tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
              onClick={() => setActiveTab('directory')}
            >
              📇 Directory
            </button>
          </div>

          <main className="main-content">
            {!supabase ? (
              <div className="empty-state">
                <h2 style={{ color: 'var(--red-color)' }}>Connection Error</h2>
                <p style={{ marginTop: '0.5rem' }}>Missing <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code> in your <code>frontend/.env</code> file.</p>
              </div>
            ) : activeTab === 'tasks' ? (
              // RENDER THE TASKS DASHBOARD
              loading && Object.keys(grouped).length === 0 ? (
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
                            gmailEmail={userSettings?.gmail_email}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : activeTab === 'graph' ? (
              // RENDER THE GRAPH CONSOLE (Chat Interface)
              <div className="graph-console-container">
                <div className="graph-settings-panel">
                  <div className="search-mode-selector">
                    <button
                      className={`mode-btn ${searchMode === 'local' ? 'active' : ''}`}
                      onClick={() => setSearchMode('local')}
                    >
                      Local Search
                    </button>
                    <button
                      className={`mode-btn ${searchMode === 'global' ? 'active' : ''}`}
                      onClick={() => setSearchMode('global')}
                    >
                      Global Search
                    </button>
                  </div>
                  <p className="mode-description">
                    {searchMode === 'local'
                      ? "🧠 Neighborhood Search: Traverses a 2-hop neighborhood of matching email threads to answer specific details, dependencies, and tasks."
                      : "🌐 Global Search: Aggregates findings from Louvain community reports to summarize high-level operational updates and themes across all threads."
                    }
                  </p>
                </div>

                <div className="graph-chat-log" ref={graphChatRef}>
                  {graphMessages.length === 0 ? (
                    <div className="graph-chat-empty">
                      <h3>Graph Intelligence Chat</h3>
                      <p>Ask questions about your email network, dependencies, and team project dynamics.</p>
                      
                      <div className="graph-query-suggestions">
                        <h4>Try asking:</h4>
                        <button onClick={() => handleQuickQuery("What are the main operational issues or project updates discussed across our vendor emails?")}>
                          🔍 What are the main operational updates across vendor emails?
                        </button>
                        <button onClick={() => handleQuickQuery("Which external organizations are involved in our project dependencies, and what are their active assignments or blockers?")}>
                          🔍 What external organizations are involved in our project dependencies?
                        </button>
                        <button onClick={() => handleQuickQuery("Summarize the active deadlines and assignments for Project Apollo.")}>
                          🔍 Summarize active deadlines and assignments for Project Apollo.
                        </button>
                      </div>
                    </div>
                  ) : (
                    graphMessages.map((msg, idx) => (
                      <div key={idx} className={`graph-message ${msg.sender}`}>
                        <div className="message-header">
                          {msg.sender === 'user' ? 'You' : 'Tasker Graph Engine'}
                        </div>
                        <div className="message-body">
                          {msg.sender === 'user' ? msg.text : renderFormattedText(msg.text, msg.citations)}
                        </div>
                      </div>
                    ))
                  )}
                  {graphLoading && (
                    <div className="graph-message ai loading">
                      <div className="message-header">Tasker Graph Engine</div>
                      <div className="message-body">
                        <div className="typing-dots"><span /><span /><span /></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="graph-input-container">
                  <input
                    type="text"
                    className="graph-chat-input"
                    placeholder="Ask about contacts, projects, or threads..."
                    value={graphInput}
                    onChange={e => setGraphInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleGraphQuery()}
                    disabled={graphLoading}
                  />
                  <button
                    className="graph-send-btn"
                    onClick={handleGraphQuery}
                    disabled={graphLoading || !graphInput.trim()}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            ) : (
              // RENDER THE CONTACTS & PROJECTS DIRECTORY
              <div className="directory-container">
                <div className="directory-subtabs">
                  <button
                    className={`subtab-btn ${directorySubTab === 'contacts' ? 'active' : ''}`}
                    onClick={() => { setDirectorySubTab('contacts'); setDirectorySearchQuery(''); }}
                  >
                    👥 Contacts & Biographies
                  </button>
                  <button
                    className={`subtab-btn ${directorySubTab === 'projects' ? 'active' : ''}`}
                    onClick={() => { setDirectorySubTab('projects'); setDirectorySearchQuery(''); }}
                  >
                    📂 Projects & Focus Areas
                  </button>
                </div>

                <div className="directory-search-bar">
                  <input
                    type="text"
                    className="directory-search-input"
                    placeholder={directorySubTab === 'contacts' ? "Search contacts by name, email, biography..." : "Search manual projects or dynamic clusters..."}
                    value={directorySearchQuery}
                    onChange={e => setDirectorySearchQuery(e.target.value)}
                  />
                </div>

                {directoryLoading ? (
                  <div className="loading-state">Updating directory indices...</div>
                ) : directorySubTab === 'contacts' ? (
                  // Contacts List
                  filteredContacts.length === 0 ? (
                    <div className="directory-empty">No contacts matched your search query.</div>
                  ) : (
                    <div className="directory-grid">
                      {filteredContacts.map(c => (
                        <div key={c.id} className="directory-card contact-card">
                          <div className="card-header">
                            <h3>{c.name || 'Unnamed Contact'}</h3>
                            {c.organization && <span className="org-badge">{c.organization}</span>}
                          </div>
                          <a href={`mailto:${c.email}`} className="contact-email">{c.email}</a>
                          <p className="contact-bio">{c.bio_summary || 'No biography compiled yet.'}</p>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  // Projects / Focus Areas List
                  <div className="projects-view-container">
                    <div className="directory-section-title">Manual Corporate Projects</div>
                    {filteredProjects.length === 0 ? (
                      <div className="directory-empty">No manual projects found.</div>
                    ) : (
                      <div className="directory-grid">
                        {filteredProjects.map(p => (
                          <div key={p.id} className="directory-card project-card">
                            <div className="card-header">
                              <h3>{p.name}</h3>
                              <span className={`status-badge ${p.status}`}>{p.status.toUpperCase()}</span>
                            </div>
                            <p className="project-description">{p.description || 'No description provided.'}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="directory-section-title" style={{ marginTop: '2.5rem' }}>Dynamic Clusters & Communities (Louvain)</div>
                    {filteredCommunities.length === 0 ? (
                      <div className="directory-empty">No dynamic communities found.</div>
                    ) : (
                      <div className="directory-grid">
                        {filteredCommunities.map(comm => {
                          const rating = parseFloat(comm.rating) || 0;
                          const ratingClass = rating >= 7 ? 'red' : rating >= 4 ? 'yellow' : 'green';
                          return (
                            <div key={comm.id} className="directory-card community-card">
                              <div className="card-header">
                                <h3>{comm.title}</h3>
                                <span className={`rating-badge ${ratingClass}`}>
                                  Priority: {rating.toFixed(1)}/10
                                </span>
                              </div>
                              <p className="rating-explanation"><em>{comm.rating_explanation}</em></p>
                              <p className="community-summary">{comm.summary}</p>
                              {comm.findings && Array.isArray(comm.findings) && comm.findings.length > 0 && (
                                <div className="community-findings">
                                  <h4>Findings:</h4>
                                  <ul>
                                    {comm.findings.map((f, i) => (
                                      <li key={i}>
                                        <strong>{f.summary}</strong>: {f.explanation}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
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

          {/* ═══ UNDER DEVELOPMENT TOAST ═══ */}
          {showMindToast && (
            <div style={{
              position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
              background: 'var(--surface-2, #1e1e2e)', border: '1px solid var(--accent)',
              borderRadius: '12px', padding: '0.85rem 1.5rem',
              display: 'flex', alignItems: 'center', gap: '0.65rem',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 9999,
              animation: 'fadeInUp 0.25s ease'
            }}>
              <span style={{ fontSize: '1.2rem' }}>🚧</span>
              <span style={{ color: 'var(--text-primary, #fff)', fontWeight: 600, fontSize: '0.9rem' }}>
                AI Mind Center — Under Development
              </span>
            </div>
          )}

          {/* ═══ CITATION CONTEXT MODAL ═══ */}
          {activeCitation && (
            <>
              <div className="modal-backdrop" onClick={() => setActiveCitation(null)} />
              <div className="citation-modal">
                <div className="modal-header">
                  <h2>Email Reference Context</h2>
                  <button className="modal-close-btn" onClick={() => setActiveCitation(null)}><X size={18} /></button>
                </div>
                <div className="modal-body">
                  <div className="meta-grid">
                    <div className="meta-item">
                      <span className="label">Subject</span>
                      <span className="value">{activeCitation.subject}</span>
                    </div>
                    <div className="meta-item">
                      <span className="label">From</span>
                      <span className="value">{activeCitation.sender}</span>
                    </div>
                    <div className="meta-item">
                      <span className="label">Date</span>
                      <span className="value">
                        {activeCitation.date ? format(new Date(activeCitation.date), 'MMM d, yyyy h:mm a') : 'Unknown'}
                      </span>
                    </div>
                  </div>
                  <div className="snippet-section">
                    <span className="label">Thread Summary / Snippet</span>
                    <p className="snippet-text">{activeCitation.snippet || 'No summary available.'}</p>
                  </div>
                  
                  <a
                    href={userSettings?.gmail_email 
                      ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(userSettings.gmail_email)}#all/${activeCitation.gmail_thread_id}`
                      : `https://mail.google.com/mail/u/0/#all/${activeCitation.gmail_thread_id}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gmail-redirection-btn"
                  >
                    Open Thread in Gmail <ExternalLink size={14} style={{ marginLeft: '6px' }} />
                  </a>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ ONBOARDING WIZARD (New Users) ═══ */}
      {wizardStep !== null && (
        <div className="onboarding-overlay">
          <div className="onboarding-card" style={{ maxWidth: '520px', width: '100%' }}>

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Welcome to Tasker</h1>
              {wizardStep !== 'progress' && (
                <p className="subtitle" style={{ margin: '0.5rem 0 0' }}>Set up your inbox in 3 quick steps</p>
              )}
            </div>

            {/* Step progress dots */}
            {wizardStep !== 'progress' && (
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '1.75rem' }}>
                {[2, 3, 4].map(s => (
                  <div key={s} style={{
                    width: '36px', height: '4px', borderRadius: '2px',
                    background: wizardStep >= s ? 'var(--accent)' : 'var(--surface-3, #2a2a3a)',
                    transition: 'background 0.3s'
                  }} />
                ))}
              </div>
            )}

            {/* ── STEP 2: Time range ── */}
            {wizardStep === 2 && (
              <div>
                <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.05rem' }}>📅 How far back should we look?</h2>
                <p style={{ margin: '0 0 1.25rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>We'll fetch emails from this period to build your knowledge graph.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '1.25rem' }}>
                  {[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }].map(({ label, value }) => (
                    <button key={value} onClick={() => setWizardFlags(f => ({ ...f, lookbackDays: value }))} style={{
                      padding: '0.85rem', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', transition: 'all 0.2s',
                      border: `2px solid ${wizardFlags.lookbackDays === value ? 'var(--accent)' : 'var(--surface-3, #2a2a3a)'}`,
                      background: wizardFlags.lookbackDays === value ? 'rgba(139,92,246,0.12)' : 'var(--surface-2, #1e1e2e)',
                      color: 'var(--text-primary, #fff)',
                    }}>{label}</button>
                  ))}
                  <button onClick={() => setWizardFlags(f => ({ ...f, lookbackDays: -1 }))} style={{
                    padding: '0.85rem', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', transition: 'all 0.2s',
                    border: `2px solid ${wizardFlags.lookbackDays === -1 ? 'var(--accent)' : 'var(--surface-3, #2a2a3a)'}`,
                    background: wizardFlags.lookbackDays === -1 ? 'rgba(139,92,246,0.12)' : 'var(--surface-2, #1e1e2e)',
                    color: 'var(--text-primary, #fff)',
                  }}>Custom</button>
                </div>
                {wizardFlags.lookbackDays === -1 && (
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <input type="number" min={1} max={365} placeholder="Days" defaultValue={60}
                      onChange={e => setWizardFlags(f => ({ ...f, customDays: parseInt(e.target.value) || 60 }))}
                      style={{ padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid var(--surface-3,#2a2a3a)', background: 'var(--surface-2,#1e1e2e)', color: 'var(--text-primary,#fff)', width: '90px', fontSize: '0.9rem' }}
                    />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>days back</span>
                  </div>
                )}
                <button className="onboarding-send" onClick={() => setWizardStep(3)} style={{ width: '100%', padding: '0.85rem', fontSize: '1rem' }}>Next →</button>
              </div>
            )}

            {/* ── STEP 3: Tracking preferences ── */}
            {wizardStep === 3 && (
              <div>
                <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.05rem' }}>🎯 What matters to you?</h2>
                <p style={{ margin: '0 0 1.25rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>We'll focus on these areas when extracting insights.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
                  {[{ id: 'tasks', label: '📋 Tasks & Action Items' }, { id: 'deadlines', label: '⏰ Deadlines & Commitments' }, { id: 'people', label: '👥 People & Follow-ups' }, { id: 'projects', label: '📁 Projects & Threads' }].map(({ id, label }) => {
                    const checked = wizardFlags.trackingPrefs.includes(id);
                    return (
                      <label key={id} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1rem',
                        borderRadius: '10px', cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s',
                        border: `2px solid ${checked ? 'var(--accent)' : 'var(--surface-3,#2a2a3a)'}`,
                        background: checked ? 'rgba(139,92,246,0.08)' : 'var(--surface-2,#1e1e2e)',
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => setWizardFlags(f => ({ ...f, trackingPrefs: checked ? f.trackingPrefs.filter(p => p !== id) : [...f.trackingPrefs, id] }))}
                          style={{ accentColor: 'var(--accent)', width: '16px', height: '16px' }} />
                        <span style={{ color: 'var(--text-primary,#fff)', fontWeight: 500 }}>{label}</span>
                      </label>
                    );
                  })}
                </div>
                <input className="onboarding-input" placeholder="Other (e.g. Legal, Finance, Compliance...)" value={wizardFlags.otherText}
                  onChange={e => setWizardFlags(f => ({ ...f, otherText: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', marginBottom: '1.25rem' }} />
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={() => setWizardStep(2)} style={{ flex: 1, padding: '0.85rem', borderRadius: '10px', border: '1px solid var(--surface-3,#2a2a3a)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
                  <button className="onboarding-send" onClick={() => { setWizardStep(4); fetchAvailableLabels(); }} style={{ flex: 2, padding: '0.85rem', fontSize: '1rem' }}>Next →</button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Source selection + label picker ── */}
            {wizardStep === 4 && (
              <div>
                <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.05rem' }}>📂 Where should we look?</h2>
                <p style={{ margin: '0 0 1.25rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Pick your email sources. We'll skip promotions, social, and updates automatically.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
                  {[{ id: 'IMPORTANT', label: '⭐ Important', desc: 'Gmail-curated · Recommended' }, { id: 'INBOX', label: '📥 Inbox', desc: 'All incoming emails' }, { id: 'SENT', label: '📤 Sent', desc: 'Emails you replied to' }].map(({ id, label, desc }) => {
                    const checked = wizardFlags.gmailLabels.includes(id);
                    return (
                      <label key={id} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1rem',
                        borderRadius: '10px', cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s',
                        border: `2px solid ${checked ? 'var(--accent)' : 'var(--surface-3,#2a2a3a)'}`,
                        background: checked ? 'rgba(139,92,246,0.08)' : 'var(--surface-2,#1e1e2e)',
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => setWizardFlags(f => ({ ...f, gmailLabels: checked ? f.gmailLabels.filter(l => l !== id) : [...f.gmailLabels, id] }))}
                          style={{ accentColor: 'var(--accent)', width: '16px', height: '16px' }} />
                        <div>
                          <div style={{ color: 'var(--text-primary,#fff)', fontWeight: 600, fontSize: '0.9rem' }}>{label}</div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.775rem' }}>{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Custom Gmail labels */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={wizardFlags.useCustomLabels}
                    onChange={e => setWizardFlags(f => ({ ...f, useCustomLabels: e.target.checked }))}
                    style={{ accentColor: 'var(--accent)', width: '16px', height: '16px' }} />
                  <span style={{ color: 'var(--text-primary,#fff)', fontWeight: 500 }}>🏷️ Use my Gmail labels</span>
                </label>
                {wizardFlags.useCustomLabels && (
                  <div style={{ border: '1px solid var(--surface-3,#2a2a3a)', borderRadius: '10px', padding: '0.5rem', maxHeight: '160px', overflowY: 'auto', marginBottom: '1rem' }}>
                    {labelsLoading ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem' }}>Loading your labels...</div>
                    ) : availableLabels.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem' }}>No custom labels found in Gmail.</div>
                    ) : availableLabels.map(lbl => {
                      const checked = wizardFlags.customLabelIds.includes(lbl.id);
                      return (
                        <label key={lbl.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.375rem 0.6rem', borderRadius: '6px', cursor: 'pointer', background: checked ? 'rgba(139,92,246,0.1)' : 'transparent' }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setWizardFlags(f => ({ ...f, customLabelIds: checked ? f.customLabelIds.filter(id => id !== lbl.id) : [...f.customLabelIds, lbl.id] }))}
                            style={{ accentColor: 'var(--accent)', width: '14px', height: '14px' }} />
                          <span style={{ color: 'var(--text-primary,#fff)', fontSize: '0.85rem' }}>{lbl.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={() => setWizardStep(3)} style={{ flex: 1, padding: '0.85rem', borderRadius: '10px', border: '1px solid var(--surface-3,#2a2a3a)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
                  <button className="onboarding-send" onClick={handleWizardComplete}
                    disabled={syncing || wizardFlags.gmailLabels.length === 0}
                    style={{ flex: 2, padding: '0.85rem', fontSize: '1rem' }}>
                    {syncing ? 'Setting up...' : '🚀 Start Syncing'}
                  </button>
                </div>
              </div>
            )}

            {/* ── PROGRESS SCREEN ── */}
            {wizardStep === 'progress' && (() => {
              const { threads_total, threads_done, eta_seconds, queue_position } = onboardingProgress;
              const etaMins = Math.ceil((eta_seconds || 0) / 60);
              const pct = threads_total > 0 ? Math.round((threads_done / threads_total) * 100) : 0;
              return (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚙️</div>
                  <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Setting up your workspace...</h2>
                  <p style={{ margin: '0 0 1.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Your graph is being built in the background.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', textAlign: 'left', marginBottom: '1.5rem' }}>
                    {[{ label: 'Emails fetched', done: threads_total > 0, extra: threads_total > 0 ? `${threads_total} threads found` : 'Scanning...' },
                      { label: 'Filtering noise', done: threads_total > 0, extra: '' },
                      { label: 'Building your graph', done: false, extra: etaMins > 0 ? `~${etaMins} min remaining` : 'Queued...' }].map(({ label, done, extra }, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1rem', borderRadius: '10px', background: 'var(--surface-2,#1e1e2e)' }}>
                        <span style={{ fontSize: '1rem' }}>{done ? '✅' : '⏳'}</span>
                        <div>
                          <div style={{ color: 'var(--text-primary,#fff)', fontWeight: 500, fontSize: '0.875rem' }}>{label}</div>
                          {extra && <div style={{ color: 'var(--text-secondary)', fontSize: '0.775rem' }}>{extra}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {threads_total > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ background: 'var(--surface-3,#2a2a3a)', borderRadius: '99px', height: '6px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: '99px', transition: 'width 1s ease' }} />
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginTop: '0.25rem' }}>{pct}% complete</div>
                    </div>
                  )}
                  {queue_position > 0 && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.825rem', margin: '0 0 0.75rem' }}>
                      {queue_position} user{queue_position > 1 ? 's' : ''} ahead of you in queue
                    </p>
                  )}
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>You can close this tab — we'll continue in the background.</p>
                </div>
              );
            })()}

          </div>
        </div>
      )}

      {/* Legacy chat onboarding — kept for fallback, no longer triggered by default */}
      {showOnboarding && wizardStep === null && (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <h1>Welcome to Tasker AI</h1>
            <p className="subtitle">Let's calibrate your personal AI mind in 3 quick steps</p>
            {synthesizing ? (
              <div className="synthesis-loading"><div className="synthesis-orb" /><p className="synthesis-status">{synthesisStatus}</p></div>
            ) : (
              <>
                <div className="onboarding-chat-area" ref={onboardingChatRef}>
                  {onboardingChat.map((m, i) => <div key={i} className={`chat-bubble ${m.sender}`}>{m.text}</div>)}
                  {onboardingChatLoading && (<div className="chat-bubble ai thinking-bubble"><span className="dot pulse-dot">•</span><span className="dot pulse-dot" style={{ animationDelay: '0.2s' }}>•</span><span className="dot pulse-dot" style={{ animationDelay: '0.4s' }}>•</span></div>)}
                </div>
                <div className="onboarding-input-area">
                  <input className="onboarding-input" value={onboardingInput} onChange={e => setOnboardingInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleOnboardingSubmit()} placeholder={onboardingChatLoading ? 'Calibrating...' : 'Speak to your Chief of Staff...'} disabled={onboardingChatLoading} />
                  <button className="onboarding-send" onClick={handleOnboardingSubmit} disabled={!onboardingInput.trim() || onboardingChatLoading}>Send <Send size={14} style={{ marginLeft: '4px' }} /></button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onToggleStar, onComplete, onTaskDelete, gmailEmail }) {
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
