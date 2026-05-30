import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export default function AskAIView({ supabase, session }) {
  const [messages, setMessages] = useState([
    { sender: 'ai', text: 'Hi! Ask me anything about your emails, contacts, or projects. I use your email graph to answer.' },
  ]);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode]     = useState('local'); // 'local' | 'global'
  const chatRef             = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { sender: 'user', text }]);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('query', {
        body: { query: text, mode },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: data?.answer || 'No response received.',
      }]);
    } catch (e) {
      console.error('[AskAI] query error:', e);
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: 'Sorry, something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="db-ai-shell">
      <div className="db-ai-header">
        <h2 className="db-ai-title">Ask AI</h2>
        <p className="db-ai-sub">Graph-powered answers from your email knowledge base.</p>
        <div className="db-ai-mode-row">
          <button
            className={`db-ai-mode-btn${mode === 'local' ? ' db-ai-mode-btn-on' : ''}`}
            onClick={() => setMode('local')}
          >
            Local search
          </button>
          <button
            className={`db-ai-mode-btn${mode === 'global' ? ' db-ai-mode-btn-on' : ''}`}
            onClick={() => setMode('global')}
          >
            Global search
          </button>
        </div>
      </div>

      <div className="db-ai-messages" ref={chatRef}>
        {messages.map((m, i) => (
          <div key={i} className={`db-ai-bubble db-ai-bubble-${m.sender}`}>
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="db-ai-typing">
            <span/><span/><span/>
          </div>
        )}
      </div>

      <div className="db-ai-input-bar">
        <input
          className="db-ai-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask about your emails, contacts, deadlines…"
          disabled={loading}
        />
        <button
          className="db-ai-send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
