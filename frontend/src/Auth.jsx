import React, { useState } from 'react';
import { Mail, ArrowRight, ShieldCheck, Zap, Sparkles } from 'lucide-react';
import './index.css';

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
            prompt: 'consent',
          },
          redirectTo: window.location.origin
        }
      });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('Error logging in:', error.message);
      alert('Error during Google login: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-icon-wrapper">
            <Sparkles className="auth-main-icon" size={32} />
          </div>
          <h1>Tasker AI</h1>
          <p>Your inbox, intelligently organized.</p>
        </div>

        <div className="auth-features">
          <div className="feature-item">
            <Zap size={18} className="feature-icon" />
            <span>Auto-extract deadlines from emails</span>
          </div>
          <div className="feature-item">
            <ShieldCheck size={18} className="feature-icon" />
            <span>Zero-retention privacy policy</span>
          </div>
        </div>

        <div className="auth-action">
          <button 
            className="google-btn glass-btn" 
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            {loading ? (
              <span className="spinner"></span>
            ) : (
              <>
                <Mail size={18} />
                <span>Continue with Gmail</span>
                <ArrowRight size={18} className="arrow-icon" />
              </>
            )}
          </button>
          
          <p className="auth-disclaimer">
            By connecting, you allow Tasker to securely read your emails strictly for task extraction. Emails are never stored.
          </p>
        </div>
      </div>
    </div>
  );
}
