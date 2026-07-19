import React, { useState, useEffect } from 'react';

export default function ProjectsView({ supabase, session }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    supabase
      .from('projects')
      .select('id, name, description, status')
      .order('name', { ascending: true })
      .then(({ data }) => {
        setProjects(data || []);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return (
    <div className="db-secondary-view">
      <div className="db-view-header">
        <h2 className="db-view-title">Projects</h2>
        <p className="db-view-sub">Focus areas extracted from your email graph.</p>
      </div>

      <div className="db-view-body">
        {loading ? (
          <div className="db-view-loading">
            <span className="db-spinner" /> Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className="db-view-empty">
            No projects yet — sync your Gmail to build the graph.
          </div>
        ) : (
          <div className="db-card-grid">
            {projects.map(p => (
              <div key={p.id} className="db-card">
                <div className="db-card-name">{p.name}</div>
                {p.description && (
                  <div className="db-card-sub">
                    {p.description.slice(0, 120)}{p.description.length > 120 ? '…' : ''}
                  </div>
                )}
                {p.status && (
                  <span className={`db-card-badge${p.status === 'active' ? ' db-card-badge-green' : ''}`}>
                    {p.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
