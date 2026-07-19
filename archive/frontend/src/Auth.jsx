import React, { useState } from 'react';
import { Shield, Lock } from 'lucide-react';
import './index.css';

/* ─────────────────────────────────────────
   Brand Icons (inline SVG for zero deps)
   ───────────────────────────────────────── */

const GmailIcon = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z"/>
    <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z"/>
    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,30.45 35,23.7 36,17"/>
    <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.203 8.228 7.837 7.258 7.837 4.908 7.837 3 9.745 3 12.298z"/>
    <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C39.868 8.203 40.772 7.837 41.742 7.837 44.092 7.837 45 9.745 45 12.298z"/>
  </svg>
);

const SlackIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>
    <path fill="#36C5F0" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>
    <path fill="#2EB67D" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    <path fill="#ECB22E" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" opacity="0"/>
  </svg>
);

const TeamsIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="#5059C9" d="M17.5 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>
    <path fill="#5059C9" d="M21 8h-7a.5.5 0 0 0-.5.5V15a3.5 3.5 0 0 0 7 0V8.5A.5.5 0 0 0 21 8z"/>
    <path fill="#7B83EB" d="M7.5 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>
    <path fill="#7B83EB" d="M13 11H2a1 1 0 0 0-1 1v7a4.5 4.5 0 0 0 9 0v-7a1 1 0 0 0-1-1z"/>
    <path fill="#464EB8" d="M13 11H7.5v8.5A4.502 4.502 0 0 1 3.098 23H9a4.5 4.5 0 0 0 4.5-4.5V12a1 1 0 0 0-.5-.867V11z" opacity="0.5"/>
  </svg>
);

const GoogleGIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

/* ─────────────────────────────────────────
   Floating Icon Network (left panel deco)
   ───────────────────────────────────────── */

const NetworkIcons = () => (
  <div className="auth-network">
    {/* Animated connecting lines */}
    <svg
      className="auth-network-lines"
      viewBox="0 0 300 200"
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Gmail → Slack */}
      <line x1="150" y1="52" x2="52" y2="138"
        stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" strokeDasharray="5 5">
        <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.6s" repeatCount="indefinite"/>
      </line>
      {/* Gmail → Teams */}
      <line x1="150" y1="52" x2="248" y2="138"
        stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" strokeDasharray="5 5">
        <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="2.1s" repeatCount="indefinite"/>
      </line>
      {/* Slack → Teams */}
      <line x1="52" y1="138" x2="248" y2="138"
        stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" strokeDasharray="5 5">
        <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="2.8s" repeatCount="indefinite"/>
      </line>
      {/* Glow dots at nodes */}
      <circle cx="150" cy="52" r="4" fill="rgba(96,165,250,0.55)"/>
      <circle cx="52" cy="138" r="3" fill="rgba(255,255,255,0.30)"/>
      <circle cx="248" cy="138" r="3" fill="rgba(255,255,255,0.30)"/>
    </svg>

    {/* Gmail — top center, slightly larger */}
    <div className="auth-node auth-node-gmail">
      <GmailIcon size={34}/>
    </div>

    {/* Slack — bottom left */}
    <div className="auth-node auth-node-slack">
      <SlackIcon size={28}/>
    </div>

    {/* Teams — bottom right */}
    <div className="auth-node auth-node-teams">
      <TeamsIcon size={28}/>
    </div>
  </div>
);

/* ─────────────────────────────────────────
   Service Card
   ───────────────────────────────────────── */

const ServiceCard = ({ icon, name, description, badge, buttonLabel, buttonIcon, onConnect, loading, primary }) => (
  <div className={`svc-card${badge ? ' svc-card-dim' : ''}`}>
    <div className="svc-icon-box">{icon}</div>

    <div className="svc-info">
      <div className="svc-name">
        {name}
        {badge && <span className="svc-badge">{badge}</span>}
      </div>
      <div className="svc-desc">{description}</div>
      <div className="svc-secure">
        <Lock size={11}/>
        <span>Secure OAuth connection</span>
      </div>
    </div>

    <button
      className={`svc-btn${primary ? ' svc-btn-primary' : ' svc-btn-outline'}`}
      onClick={onConnect}
      disabled={!!badge || loading}
    >
      {loading ? (
        <span className="svc-spinner"/>
      ) : (
        <>
          {buttonIcon}
          {buttonLabel}
        </>
      )}
    </button>
  </div>
);

/* ─────────────────────────────────────────
   Main Auth Component
   ───────────────────────────────────────── */

export default function Auth({ supabase }) {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/gmail.readonly',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent', // Forces Google to return refresh_token every login
          },
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google login error:', error.message);
      alert('Error during Google login: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">

      {/* ══════════════ LEFT PANEL ══════════════ */}
      <div className="auth-left">

        {/* Brand */}
        <div className="auth-brand-row">
          <img src="/icons/logo.png" alt="Tasker AI" className="auth-brand-logo"/>
          <span className="auth-brand-name">Tasker AI</span>
        </div>

        {/* Welcome pill */}
        <div className="auth-welcome-pill">
          <span>👋</span>
          <span>Welcome to Tasker AI</span>
        </div>

        {/* Hero headline */}
        <h1 className="auth-hero-title">
          Connect your tools.<br/>
          Unify your <span className="auth-hero-accent">work.</span>
        </h1>

        {/* Subtext */}
        <p className="auth-hero-sub">
          Integrate your communication tools to bring emails, tasks, and deadlines into one intelligent workspace.
        </p>

        {/* Floating icon network */}
        <NetworkIcons/>

        {/* Security note */}
        <div className="auth-security-row">
          <Shield size={14}/>
          <span>Your data is encrypted and secure.</span>
          <span className="auth-security-sep">·</span>
          <span className="auth-security-link">Learn more about our security</span>
        </div>
      </div>

      {/* ══════════════ RIGHT PANEL ══════════════ */}
      <div className="auth-right">
        <div className="auth-right-inner">

          <h2 className="auth-connect-title">Let's connect your accounts</h2>
          <p className="auth-connect-sub">
            Select the tools you use. You can always add more later.
          </p>

          {/* Google (Gmail) — Active */}
          <ServiceCard
            icon={<GmailIcon size={32}/>}
            name="Google (Gmail)"
            description="Connect your Gmail account to sync emails, extract tasks and deadlines automatically."
            buttonLabel="Connect Google"
            buttonIcon={<GoogleGIcon size={16}/>}
            onConnect={handleGoogleLogin}
            loading={loading}
            primary
          />

          {/* Slack — Coming Soon */}
          <ServiceCard
            icon={<SlackIcon size={32}/>}
            name="Slack"
            description="Connect Slack to bring in your conversations, channels and notifications."
            badge="Coming Soon"
            buttonLabel="Connect Slack"
            buttonIcon={<SlackIcon size={14}/>}
          />

          {/* Microsoft Teams — Coming Soon */}
          <ServiceCard
            icon={<TeamsIcon size={32}/>}
            name="Microsoft Teams"
            description="Connect Teams to access your chats, meetings and files in one place."
            badge="Coming Soon"
            buttonLabel="Connect Teams"
            buttonIcon={<TeamsIcon size={14}/>}
          />

          <p className="auth-trust-footer">
            🔒 We never post or access your messages without permission.
            You can disconnect any integration at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
