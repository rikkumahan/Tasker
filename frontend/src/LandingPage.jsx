import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Mic,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';

const PAGE_AGENT_BASE_URL = import.meta.env.VITE_PAGE_AGENT_BASE_URL || 'https://api.groq.com/openai/v1';
const PAGE_AGENT_API_KEY = import.meta.env.VITE_PAGE_AGENT_API_KEY || '';
const PAGE_AGENT_MODEL = import.meta.env.VITE_PAGE_AGENT_MODEL || 'llama-3.3-70b-versatile';

const demoSteps = [
  {
    eyebrow: 'Inbox scan',
    title: 'Turns dense email into a work queue.',
    body: 'This area will explain how Tasker reads communication, removes noise, and surfaces the threads that need action.',
    command: 'Show me what needs attention today.',
  },
  {
    eyebrow: 'Knowledge graph',
    title: 'Connects people, projects, threads, and tasks.',
    body: 'This block is reserved for your graph story: who is involved, what is blocked, and which conversations created the context.',
    command: 'Find the project and the people connected to this deadline.',
  },
  {
    eyebrow: 'Guided demo',
    title: 'Lets visitors ask the page to navigate itself.',
    body: 'PageAgent can run inside the page and operate the current interface through DOM structure, while the scripted guide remains available as a safe fallback.',
    command: 'Walk me through the product without signing in.',
  },
];

const storyBlocks = [
  {
    label: 'What it is',
    text: 'Placeholder for your clear product explanation. Keep this specific, grounded, and written in your own voice.',
  },
  {
    label: 'Why it matters',
    text: 'Placeholder for the pain: scattered commitments, buried follow-ups, and context lost across threads.',
  },
  {
    label: 'How it works',
    text: 'Placeholder for the system: Gmail sync, privacy shield, graph extraction, task intelligence, and Ask AI.',
  },
];

function maskSensitiveContent(content) {
  return content
    .replace(/\b([a-zA-Z0-9._%+-])[^@\s]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, '$1***$2')
    .replace(/\b(?:\+?\d[\s.-]?){9,15}\b/g, '[masked-phone]')
    .replace(/\b(token|apikey|api_key|authorization|bearer)\s*[:=]\s*[^\s"'<>]+/gi, '$1=[masked-secret]')
    .replace(/\bgsk_[A-Za-z0-9_-]{20,}\b/g, '[masked-groq-key]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[masked-jwt]');
}

export default function LandingPage({ onStartLogin }) {
  const [activeStep, setActiveStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [agentStatus, setAgentStatus] = useState('idle');
  const [groqKey, setGroqKey] = useState('');
  const agentRef = useRef(null);
  const timerRef = useRef(null);

  const agentApiKey = PAGE_AGENT_API_KEY || groqKey.trim();
  const pageAgentConfigured = Boolean(PAGE_AGENT_BASE_URL && PAGE_AGENT_MODEL && agentApiKey);
  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    []
  );

  const active = demoSteps[activeStep];

  useEffect(() => {
    if (!playing) return undefined;
    timerRef.current = window.setInterval(() => {
      setActiveStep(current => (current + 1) % demoSteps.length);
    }, 4300);
    return () => {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [playing]);

  useEffect(() => {
    if (!voiceOn || !speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${active.eyebrow}. ${active.title} ${active.body}`);
    utterance.rate = 0.92;
    utterance.pitch = 0.98;
    window.speechSynthesis.speak(utterance);
  }, [active, speechSupported, voiceOn]);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (speechSupported) window.speechSynthesis.cancel();
    agentRef.current?.dispose?.();
  }, [speechSupported]);

  const moveStep = (direction) => {
    setPlaying(false);
    setActiveStep(current => (current + direction + demoSteps.length) % demoSteps.length);
  };

  const toggleVoice = () => {
    if (!speechSupported) return;
    setVoiceOn(current => {
      if (current) window.speechSynthesis.cancel();
      return !current;
    });
  };

  const openPageAgent = async () => {
    if (!pageAgentConfigured) {
      setAgentStatus('missing-config');
      return;
    }

    try {
      setAgentStatus('loading');
      if (!agentRef.current) {
        const { PageAgent } = await import('page-agent');
        agentRef.current = new PageAgent({
          baseURL: PAGE_AGENT_BASE_URL,
          apiKey: agentApiKey,
          model: PAGE_AGENT_MODEL,
          language: 'en-US',
          maxSteps: 8,
          enableMask: true,
          viewportExpansion: -1,
          interactiveBlacklist: [
            () => document.querySelector('[data-agent-private="true"]'),
            () => document.querySelector('[data-agent-no-touch="true"]'),
          ],
          includeAttributes: ['data-agent-*', 'aria-label'],
          keepSemanticTags: true,
          transformPageContent: maskSensitiveContent,
          instructions: {
            system: [
              'You are the Tasker product demo operator.',
              'Only guide the visitor through public landing page content and the demo sandbox.',
              'Do not click sign-in, OAuth, sync, destructive, account, or private-data controls.',
              'If a request needs real user data, explain that sign-in is required and stop.',
              'Ask before changing form fields or starting a workflow.',
            ].join('\n'),
            getPageInstructions: () => 'This is a public marketing/demo page. Prefer explanation and navigation over mutation.',
          },
        });
      }
      agentRef.current.panel?.show?.();
      setAgentStatus('ready');
    } catch (error) {
      console.error('[LandingPage] PageAgent failed:', error);
      setAgentStatus('error');
    }
  };

  const runPageAgentDemo = async () => {
    await openPageAgent();
    if (!agentRef.current) return;
    try {
      setAgentStatus('running');
      await agentRef.current.execute('Walk through the public Tasker demo panels. Do not click sign in.');
      setAgentStatus('ready');
    } catch (error) {
      console.error('[LandingPage] PageAgent execute failed:', error);
      setAgentStatus('error');
    }
  };

  return (
    <main className="lp-page">
      <nav className="lp-nav" aria-label="Landing navigation">
        <div className="lp-brand">
          <img src="/icons/logo.png" alt="" className="lp-brand-logo" />
          <span>Tasker</span>
        </div>
        <div className="lp-nav-actions" data-agent-private="true">
          <button className="lp-link-btn" type="button" onClick={openPageAgent}>
            PageAgent
          </button>
          <button className="lp-nav-btn" type="button" onClick={onStartLogin}>
            Sign in
          </button>
        </div>
      </nav>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-kicker">
            <Sparkles size={14} />
            Public demo page under construction
          </div>
          <h1>Explain the product beautifully before asking for the inbox.</h1>
          <p className="lp-hero-sub">
            A sharp starting page for Tasker: your copy can land here later, while the demo,
            voice narration, and PageAgent controls already respect user privacy and backend load.
          </p>
          <div className="lp-hero-actions" data-agent-private="true">
            <button className="lp-primary-btn" type="button" onClick={onStartLogin}>
              Connect Google
              <ArrowRight size={17} />
            </button>
            <button
              className="lp-secondary-btn"
              type="button"
              onClick={() => {
                setPlaying(true);
                setActiveStep(0);
              }}
            >
              <Play size={16} />
              Run demo
            </button>
          </div>
        </div>

        <div className="lp-console" data-agent-sandbox="landing-demo">
          <div className="lp-console-top">
            <span />
            <span />
            <span />
            <p>demo.operator</p>
          </div>
          <div className="lp-command-line">
            <Bot size={18} />
            <span>{active.command}</span>
          </div>
          <div className="lp-demo-grid">
            {demoSteps.map((step, index) => (
              <button
                key={step.eyebrow}
                className={`lp-demo-tile${activeStep === index ? ' lp-demo-tile-on' : ''}`}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setActiveStep(index);
                }}
              >
                <span>{step.eyebrow}</span>
                <strong>{step.title}</strong>
              </button>
            ))}
          </div>
          <div className="lp-demo-detail" aria-live="polite">
            <div>
              <p className="lp-demo-label">{active.eyebrow}</p>
              <h2>{active.title}</h2>
              <p>{active.body}</p>
            </div>
            <div className="lp-demo-controls">
              <button type="button" onClick={() => moveStep(-1)} aria-label="Previous demo step">
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPlaying(current => !current)}
                aria-label={playing ? 'Pause demo' : 'Play demo'}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button type="button" onClick={() => moveStep(1)} aria-label="Next demo step">
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={voiceOn ? 'Turn voice off' : 'Turn voice on'}
                disabled={!speechSupported}
              >
                {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-content-band">
        <div className="lp-section-heading">
          <p>Write this with me later</p>
          <h2>Content slots that are ready for the real story.</h2>
        </div>
        <div className="lp-story-grid">
          {storyBlocks.map(block => (
            <article className="lp-story-block" key={block.label}>
              <span>{block.label}</span>
              <p>{block.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-agent-band">
        <div className="lp-agent-copy">
          <div className="lp-kicker lp-kicker-light">
            <Wand2 size={14} />
            PageAgent + web TTS
          </div>
          <h2>Demo assistance belongs in the browser, not in your sync engine.</h2>
          <p>
            The guide uses local React state and the Web Speech API. PageAgent is loaded on demand
            for DOM navigation, with masking and action boundaries so demo traffic does not become
            Supabase Edge Function traffic.
          </p>
        </div>
        <div className="lp-guardrails">
          <div>
            <ShieldCheck size={20} />
            <span>Public-page only by default</span>
          </div>
          <div>
            <LockKeyhole size={20} />
            <span>PII and secrets masked before agent context</span>
          </div>
          <div>
            <BrainCircuit size={20} />
            <span>Per-tab agent state for multi-user safety</span>
          </div>
          <div>
            <Mic size={20} />
            <span>TTS runs through browser speech synthesis</span>
          </div>
        </div>
        <div className="lp-agent-actions" data-agent-no-touch="true">
          {!PAGE_AGENT_API_KEY && (
            <label className="lp-key-field">
              <span>Groq key for this tab</span>
              <input
                type="password"
                value={groqKey}
                onChange={event => setGroqKey(event.target.value)}
                placeholder="gsk_..."
                autoComplete="off"
                spellCheck="false"
              />
            </label>
          )}
          <button className="lp-primary-btn lp-primary-dark" type="button" onClick={runPageAgentDemo}>
            Open PageAgent demo
            <ArrowRight size={17} />
          </button>
          <p className="lp-agent-status">
            {agentStatus === 'missing-config'
              ? 'Paste a Groq key for this tab, or set VITE_PAGE_AGENT_API_KEY locally.'
              : agentStatus === 'error'
                ? 'PageAgent could not start. The scripted demo still works.'
                : agentStatus === 'running'
                  ? 'PageAgent is navigating the public demo.'
                  : pageAgentConfigured
                    ? `Groq PageAgent ready with ${PAGE_AGENT_MODEL}.`
                    : 'Scripted demo is active. Paste a Groq key to enable live PageAgent.'}
          </p>
        </div>
      </section>

      <section className="lp-proof-strip" aria-label="Demo guardrails">
        <div>
          <CheckCircle2 size={17} />
          No anonymous sync calls
        </div>
        <div>
          <CheckCircle2 size={17} />
          No stored demo transcripts
        </div>
        <div>
          <CheckCircle2 size={17} />
          No raw inbox access before OAuth
        </div>
      </section>
    </main>
  );
}
