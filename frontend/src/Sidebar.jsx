import React, { useState } from 'react';
import { RefreshCw, LogOut, Settings, Users, FolderOpen, Brain, CheckSquare, Trash2 } from 'lucide-react';

const NavItem = ({ view, icon, label, badge, tag, activeView, onNavigate }) => (
  <button
    className={`db-nav-item${activeView === view ? ' db-nav-item-on' : ''}`}
    onClick={() => onNavigate(view)}
  >
    {icon}
    <span className="db-nav-label">{label}</span>
    {badge > 0 && <span className="db-nav-badge">{badge}</span>}
    {tag && <span style={{ fontSize: '10px', background: '#3b82f6', color: 'white', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto', fontWeight: 'bold' }}>{tag}</span>}
  </button>
);

export default function Sidebar({ activeView, threadCounts, userSettings, syncing, session, onNavigate, onSync, onSignOut, onDeleteAccount }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fullName = session?.user?.user_metadata?.full_name || '';
  const initials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (session?.user?.email?.[0] || '?').toUpperCase();

  return (
    <aside className="db-sidebar">
      {/* Brand */}
      <div className="db-brand">
        <img src="/icons/logo.png" alt="Tasker AI" className="db-brand-logo" />
        <span className="db-brand-name">Tasker AI</span>
      </div>

      {/* Main nav */}
      <nav className="db-nav">
        <NavItem view="tasks"    icon={<CheckSquare size={16}/>} label="Tasks"    badge={threadCounts.inbox} activeView={activeView} onNavigate={onNavigate} />
        <NavItem view="people"   icon={<Users size={16}/>}       label="People"   badge={0}                  activeView={activeView} onNavigate={onNavigate} />
        <NavItem view="projects" icon={<FolderOpen size={16}/>}  label="Projects" badge={0}                  activeView={activeView} onNavigate={onNavigate} />
      </nav>

      {/* AI Tools section */}
      <div className="db-nav-section-label">AI Tools</div>
      <nav className="db-nav">
        <NavItem view="askai" icon={<Brain size={16}/>} label="Ask AI" badge={0} tag="Experimental" activeView={activeView} onNavigate={onNavigate} />
      </nav>

      {/* Bottom row: sync + settings + avatar */}
      <div className="db-sidebar-bottom">
        <div className="db-settings-wrap">
          <button className="db-settings-btn" onClick={() => setSettingsOpen(o => !o)} title="Settings">
            <Settings size={15} />
          </button>

          {settingsOpen && (
            <>
              <div className="db-settings-overlay" onClick={() => setSettingsOpen(false)} />
              <div className="db-settings-popup">
                <div className="db-settings-email">
                  {userSettings?.gmail_email || session?.user?.email || 'Unknown'}
                </div>
                {userSettings?.last_synced_at && (
                  <div className="db-settings-sync">
                    Last synced:{' '}
                    {new Date(userSettings.last_synced_at).toLocaleTimeString([], {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                )}
                
                {/* Fallback Sync for SDLC Resiliency */}
                <button
                  className="db-signout-btn"
                  onClick={onSync}
                  disabled={syncing}
                  style={{ borderBottom: '1px solid #333', marginBottom: '8px' }}
                >
                  <RefreshCw size={14} style={{ marginRight: '8px' }} />
                  {syncing ? 'Syncing...' : 'Force Sync'}
                </button>

                <button
                  className="db-signout-btn"
                  onClick={() => { setSettingsOpen(false); onSignOut(); }}
                >
                  <LogOut size={14} style={{ marginRight: '8px' }} /> Sign Out
                </button>

                <button
                  className="db-signout-btn"
                  onClick={() => { setSettingsOpen(false); onDeleteAccount(); }}
                  style={{ color: '#ef4444', marginTop: '4px' }}
                >
                  <Trash2 size={14} style={{ marginRight: '8px' }} /> Delete Account
                </button>
              </div>
            </>
          )}
        </div>

        <div className="db-avatar" title={session?.user?.email}>{initials}</div>
      </div>
    </aside>
  );
}
