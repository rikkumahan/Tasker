import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import Auth from './Auth';
import Dashboard from './Dashboard';
import LandingPage from './LandingPage';
import './index.css';

// ── Supabase client (singleton) ──
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

export default function App() {
  const [session, setSession]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // ── Wizard state ── (stays here because the wizard overlay renders above <Dashboard>)
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
  const [labelsLoading, setLabelsLoading]     = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState({
    threads_total: 0, threads_done: 0, eta_seconds: 0, queue_position: 0,
  });
  const [syncing, setSyncing] = useState(false); // wizard's "Start Syncing" spinner only

  const sessionRef              = React.useRef(null);
  const initialSyncDoneRef      = React.useRef(false);
  const onboardingTriggeredRef  = React.useRef(false);
  const onboardingPollRef       = React.useRef(null);
  const providerTokenRef        = React.useRef(null);

  // ── Session management ──
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      sessionRef.current = sess;
      setSession(sess);
      setLoading(false);
      if (sess) checkSyncHealth(sess);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      sessionRef.current = newSession;
      setSession(newSession);
      if (newSession) {
        if (_event === 'SIGNED_IN' && newSession.provider_token) {
          bootstrapUser(newSession);
        }
      } else {
        setWizardStep(null);
        initialSyncDoneRef.current = false;
        onboardingTriggeredRef.current = false;
      }
    });

    return () => {
      subscription.unsubscribe();
      if (onboardingPollRef.current) clearInterval(onboardingPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── checkSyncHealth: runs once on restore to catch in-progress onboarding ──
  const checkSyncHealth = async (sess) => {
    if (initialSyncDoneRef.current || !sess) return;
    initialSyncDoneRef.current = true;

    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_profile, last_synced_at, onboarding_status, onboarding_progress')
      .eq('user_id', sess.user.id)
      .maybeSingle();

    if (settings?.onboarding_status === 'queued' || settings?.onboarding_status === 'processing') {
      if (settings.onboarding_progress) setOnboardingProgress(settings.onboarding_progress);
      setWizardStep('progress');
      startOnboardingPolling(sess);
      return;
    }

    if (settings?.onboarding_status === 'complete') {
      return; // Onboarding is done, don't show the wizard again even if profile is default
    }

    const DEFAULT_PROFILE = "A busy professional seeking to organize their schedule, extract actionable tasks from communications, and manage deadlines efficiently.";
    if (!settings || !settings.user_profile || settings.user_profile === DEFAULT_PROFILE) {
      if (sess?.provider_token && !providerTokenRef.current?.providerToken) {
        providerTokenRef.current = {
          providerToken: sess.provider_token,
          providerRefreshToken: sess.provider_refresh_token,
        };
      }
      setWizardStep(2);
    }
  };

  // ── bootstrapUser: called only on true first SIGNED_IN with fresh provider_token ──
  const bootstrapUser = async (sess) => {
    if (onboardingTriggeredRef.current) return;
    onboardingTriggeredRef.current = true;

    // Fast-check if they are actually a returning user to prevent showing wizard again
    const { data: settings } = await supabase
      .from('user_settings')
      .select('onboarding_status')
      .eq('user_id', sess.user.id)
      .maybeSingle();

    if (settings?.onboarding_status === 'complete') {
      return; // Returning user signing in on a new device, skip wizard entirely
    }

    providerTokenRef.current = {
      providerToken: sess?.provider_token,
      providerRefreshToken: sess?.provider_refresh_token,
    };
    setWizardStep(2);
    // Dashboard handles its own data fetching on mount
  };

  // ── fetchAvailableLabels: populates the Step 4 label picker ──
  const fetchAvailableLabels = async () => {
    setLabelsLoading(true);
    try {
      const sess = sessionRef.current;
      const { data, error } = await supabase.functions.invoke('labels', {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${sess.access_token}` },
      });
      if (!error && data?.labels) setAvailableLabels(data.labels);
    } catch (e) {
      console.error('[LABELS] fetch error:', e);
    }
    setLabelsLoading(false);
  };

  // ── startOnboardingPolling: polls user_settings every 10s until onboarding complete ──
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
        if (settings?.onboarding_progress) setOnboardingProgress(settings.onboarding_progress);
        if (settings?.onboarding_status === 'complete') {
          clearInterval(onboardingPollRef.current);
          onboardingPollRef.current = null;
          setWizardStep(null); // Dashboard re-fetches threads via its wizardStep dep
        }
      } catch (e) {
        console.error('[POLL] onboarding_status error:', e);
      }
    }, 10000);
  };

  // ── handleWizardComplete: triggers bootstrap sync from wizard Step 4 ──
  const handleWizardComplete = async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    setSyncing(true);
    try {
      const effective = wizardFlags.lookbackDays === -1
        ? (wizardFlags.customDays || 60)
        : wizardFlags.lookbackDays;

      const { data, error } = await supabase.functions.invoke('sync', {
        body: {
          ...(providerTokenRef.current || {}),
          sync_flags: {
            lookback_days: effective,
            tracking_preferences: [
              ...wizardFlags.trackingPrefs,
              ...(wizardFlags.otherText.trim() ? [wizardFlags.otherText.trim()] : []),
            ],
            gmail_labels: wizardFlags.gmailLabels,
            custom_label_ids: wizardFlags.customLabelIds,
          },
          bootstrap_only: true,
        },
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${sess.access_token}` },
      });
      if (error) throw error;
      setOnboardingProgress({
        threads_total: 0, threads_done: 0,
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

  // ── Render ──
  if (!supabase) {
    return (
      <div style={{ padding: '2rem', color: '#dc2626', fontFamily: 'sans-serif' }}>
        <strong>Configuration error:</strong> Missing{' '}
        <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code>{' '}
        in <code>frontend/.env</code>.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
        <span className="db-spinner" />
      </div>
    );
  }

  if (!session) {
    return showAuth
      ? <Auth supabase={supabase} />
      : <LandingPage onStartLogin={() => setShowAuth(true)} />;
  }

  return (
    <>
      <Dashboard
        session={session}
        supabase={supabase}
        wizardStep={wizardStep}
        onSignOut={() => supabase.auth.signOut()}
      />

      {/* ═══ ONBOARDING WIZARD (New Users) — fixed overlay above Dashboard ═══ */}
      {wizardStep !== null && (
        <div className="wz-page">

          {/* Top bar */}
          <div className="wz-topbar">
            <div className="wz-brand">
              <img src="/icons/logo.png" alt="Tasker AI" className="wz-logo"/>
              <span className="wz-brand-name">Tasker AI</span>
            </div>
            {wizardStep !== 'progress' && (
              <span className="wz-step-label">Step {wizardStep - 1} of 3</span>
            )}
          </div>

          {/* Step dots */}
          {wizardStep !== 'progress' && (
            <div className="wz-dots">
              <div className={`wz-dot${wizardStep >= 2 ? ' wz-dot-on' : ''}`}/>
              <div className={`wz-dot${wizardStep >= 3 ? ' wz-dot-on' : ''}`}/>
              <div className={`wz-dot${wizardStep >= 4 ? ' wz-dot-on' : ''}`}/>
            </div>
          )}

          {/* Body */}
          <div className="wz-body">

            {/* ── STEP 2: Time range ── */}
            {wizardStep === 2 && (
              <div>
                <h2 className="wz-title">How far back should we look?</h2>
                <p className="wz-subtitle">We'll fetch emails from this period to extract your tasks and deadlines.</p>
                <div className="wz-grid-2">
                  {[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }, { label: 'Custom', value: -1 }].map(({ label, value }) => {
                    const sel = wizardFlags.lookbackDays === value;
                    return (
                      <button
                        key={value}
                        className={`wz-tile${sel ? ' wz-tile-on' : ''}`}
                        onClick={() => setWizardFlags(f => ({ ...f, lookbackDays: value }))}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {wizardFlags.lookbackDays === -1 && (
                  <div className="wz-custom-row">
                    <input
                      type="number" min={1} max={365} placeholder="60" defaultValue={60}
                      className="wz-input wz-input-sm"
                      onChange={e => setWizardFlags(f => ({ ...f, customDays: parseInt(e.target.value) || 60 }))}
                    />
                    <span className="wz-custom-label">days back</span>
                  </div>
                )}
                <div className="wz-nav">
                  <button className="wz-next-btn" onClick={() => setWizardStep(3)}>Continue</button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Tracking preferences ── */}
            {wizardStep === 3 && (
              <div>
                <h2 className="wz-title">What matters to you?</h2>
                <p className="wz-subtitle">We'll focus on these areas when extracting insights from your inbox.</p>
                <div className="wz-option-list">
                  {[
                    { id: 'tasks',     label: 'Tasks & Action Items',    desc: 'Things you need to do or follow up on' },
                    { id: 'deadlines', label: 'Deadlines & Commitments', desc: 'Dates, due dates, and time-sensitive items' },
                    { id: 'people',    label: 'People & Follow-ups',     desc: 'Contacts you need to get back to' },
                    { id: 'projects',  label: 'Projects & Threads',      desc: 'Ongoing work and multi-email conversations' },
                  ].map(({ id, label, desc }) => {
                    const checked = wizardFlags.trackingPrefs.includes(id);
                    return (
                      <label key={id} className={`wz-option${checked ? ' wz-option-on' : ''}`}>
                        <div className={`wz-cb${checked ? ' wz-cb-on' : ''}`}>
                          {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setWizardFlags(f => ({ ...f, trackingPrefs: checked ? f.trackingPrefs.filter(p => p !== id) : [...f.trackingPrefs, id] }))
                        } style={{ display: 'none' }}/>
                        <div>
                          <div className="wz-option-label">{label}</div>
                          <div className="wz-option-desc">{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <input
                  className="wz-input"
                  placeholder="Other categories (e.g. Legal, Finance, Compliance...)"
                  value={wizardFlags.otherText}
                  onChange={e => setWizardFlags(f => ({ ...f, otherText: e.target.value }))}
                />
                <div className="wz-nav">
                  <button className="wz-back-btn" onClick={() => setWizardStep(2)}>← Back</button>
                  <button className="wz-next-btn" onClick={() => { setWizardStep(4); fetchAvailableLabels(); }}>Continue</button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Source selection ── */}
            {wizardStep === 4 && (
              <div>
                <h2 className="wz-title">Where should we look?</h2>
                <p className="wz-subtitle">Pick your email sources. Promotions, social, and updates are skipped automatically.</p>
                <div className="wz-option-list">
                  {[
                    { id: 'IMPORTANT', label: 'Important', desc: 'Gmail-curated · Recommended' },
                    { id: 'INBOX',     label: 'Inbox',     desc: 'All incoming emails' },
                    { id: 'SENT',      label: 'Sent',      desc: 'Emails you replied to' },
                  ].map(({ id, label, desc }) => {
                    const checked = wizardFlags.gmailLabels.includes(id);
                    return (
                      <label key={id} className={`wz-option${checked ? ' wz-option-on' : ''}`}>
                        <div className={`wz-cb${checked ? ' wz-cb-on' : ''}`}>
                          {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setWizardFlags(f => ({ ...f, gmailLabels: checked ? f.gmailLabels.filter(l => l !== id) : [...f.gmailLabels, id] }))
                        } style={{ display: 'none' }}/>
                        <div>
                          <div className="wz-option-label">{label}</div>
                          <div className="wz-option-desc">{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <label className={`wz-option wz-option-sm${wizardFlags.useCustomLabels ? ' wz-option-on' : ''}`}>
                  <div className={`wz-cb${wizardFlags.useCustomLabels ? ' wz-cb-on' : ''}`}>
                    {wizardFlags.useCustomLabels && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={wizardFlags.useCustomLabels}
                    onChange={e => setWizardFlags(f => ({ ...f, useCustomLabels: e.target.checked }))}
                    style={{ display: 'none' }}/>
                  <div className="wz-option-label">Use my Gmail labels</div>
                </label>
                {wizardFlags.useCustomLabels && (
                  <div className="wz-labels-panel">
                    {labelsLoading ? (
                      <div className="wz-labels-empty">Loading your labels...</div>
                    ) : availableLabels.length === 0 ? (
                      <div className="wz-labels-empty">No custom labels found in Gmail.</div>
                    ) : availableLabels.map(lbl => {
                      const checked = wizardFlags.customLabelIds.includes(lbl.id);
                      return (
                        <label key={lbl.id} className={`wz-label-row${checked ? ' wz-label-row-on' : ''}`}>
                          <div className={`wz-cb wz-cb-sm${checked ? ' wz-cb-on' : ''}`}>
                            {checked && <svg width="8" height="6" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <input type="checkbox" checked={checked}
                            onChange={() => setWizardFlags(f => ({ ...f, customLabelIds: checked ? f.customLabelIds.filter(id => id !== lbl.id) : [...f.customLabelIds, lbl.id] }))}
                            style={{ display: 'none' }}/>
                          <span className="wz-label-name">{lbl.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="wz-nav">
                  <button className="wz-back-btn" onClick={() => setWizardStep(3)}>← Back</button>
                  <button
                    className="wz-next-btn"
                    onClick={handleWizardComplete}
                    disabled={syncing || wizardFlags.gmailLabels.length === 0}
                  >
                    {syncing ? 'Setting up...' : 'Start Syncing'}
                  </button>
                </div>
              </div>
            )}

            {/* ── PROGRESS SCREEN ── */}
            {wizardStep === 'progress' && (() => {
              const { threads_total, threads_done, eta_seconds, queue_position } = onboardingProgress;
              const etaMins = Math.ceil((eta_seconds || 0) / 60);
              const pct = threads_total > 0 ? Math.round((threads_done / threads_total) * 100) : 0;
              const steps = [
                { label: 'Fetching emails',     detail: threads_total > 0 ? `${threads_total} threads found` : 'Scanning your inbox...', done: threads_total > 0 },
                { label: 'Filtering noise',     detail: 'Removing promotions & social', done: threads_total > 0 },
                { label: 'Building your graph', detail: etaMins > 0 ? `~${etaMins} min remaining` : 'Queued...', done: false },
              ];
              return (
                <div className="wz-progress">
                  <div className="wz-spinner"/>
                  <h2 className="wz-title" style={{ textAlign: 'center' }}>Setting up your workspace</h2>
                  <p className="wz-subtitle" style={{ textAlign: 'center' }}>Your graph is being built in the background.</p>
                  <div className="wz-status-list">
                    {steps.map(({ label, detail, done }, i) => (
                      <div key={i} className="wz-status-row">
                        <div className={`wz-status-icon${done ? ' wz-status-icon-done' : ''}`}>
                          {done
                            ? <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : <div className="wz-status-pending"/>}
                        </div>
                        <div>
                          <div className={`wz-status-text${done ? ' wz-status-text-done' : ''}`}>{label}</div>
                          {detail && <div className="wz-status-detail">{detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {threads_total > 0 && (
                    <>
                      <div className="wz-pbar-wrap">
                        <div className="wz-pbar-fill" style={{ width: `${pct}%` }}/>
                      </div>
                      <div className="wz-pbar-label">{pct}% complete</div>
                    </>
                  )}
                  {queue_position > 0 && (
                    <p className="wz-queue-note">{queue_position} user{queue_position > 1 ? 's' : ''} ahead of you in queue</p>
                  )}
                  <p className="wz-close-note">You can close this tab — we'll continue in the background.</p>
                </div>
              );
            })()}

          </div>
        </div>
      )}
    </>
  );
}
