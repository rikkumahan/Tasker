import React, { useState, useEffect } from 'react';

export default function PeopleView({ supabase, session }) {
  const [contacts, setContacts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    supabase
      .from('contacts')
      .select('id, name, email, organization, bio_summary')
      .eq('user_id', session.user.id)
      .order('name', { ascending: true })
      .then(({ data }) => {
        setContacts(data || []);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const filtered = contacts.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.organization?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="db-secondary-view">
      <div className="db-view-header">
        <h2 className="db-view-title">People</h2>
        <p className="db-view-sub">Contacts extracted from your Gmail threads.</p>
        <input
          style={{
            marginTop: '0.75rem', width: '100%', padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db', borderRadius: '6px',
            fontSize: '0.875rem', color: '#111827', outline: 'none',
            fontFamily: 'inherit',
          }}
          placeholder="Search by name, email, or organisation…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="db-view-body">
        {loading ? (
          <div className="db-view-loading">
            <span className="db-spinner" /> Loading contacts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="db-view-empty">
            {search ? 'No contacts match your search.' : 'No contacts yet — sync your Gmail to build the graph.'}
          </div>
        ) : (
          <div className="db-card-grid">
            {filtered.map(c => (
              <div key={c.id} className="db-card">
                <div className="db-card-name">{c.name || c.email}</div>
                {c.email && <div className="db-card-sub">{c.email}</div>}
                {c.organization && (
                  <span className="db-card-badge">{c.organization}</span>
                )}
                {c.bio_summary && (
                  <div className="db-card-sub" style={{ marginTop: '0.5rem', fontSize: '0.76rem' }}>
                    {c.bio_summary.slice(0, 100)}{c.bio_summary.length > 100 ? '…' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
