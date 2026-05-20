# Contract: Frontend Props

**Interface**: Supabase query result → ActionCard React component
**Direction**: Database → UI

---

## ActionCard Props

```typescript
interface ActionCardProps {
  // Identity
  id: string;
  sourceEmailId: string;

  // Core content
  title: string;
  summary: string;
  deadline: string | null;

  // New: action insight fields
  actionType: 'approval_required' | 'reply_needed' | 'blocker' | 'event' | 'delegated_tracking' | 'awareness' | null;
  impactLevel: 'high' | 'medium' | 'low' | null;
  senderOrganization: string | null;
  escalationRisk: string | null;
  suggestedReplyDraft: {
    options: Array<{ label: string; text: string }>;
  } | null;

  // Existing fields
  category: string | null;       // used as cluster label
  warnings: string[] | null;
  starred: boolean;
  status: 'pending' | 'ignored' | 'done';
  createdAt: string;
  updatedAt: string;

  // Callbacks
  onStar: (id: string) => void;
  onDismiss: (id: string) => void;
  onCopyDraft: (text: string) => void;
}
```

---

## Visual Tokens (index.css)

```css
/* Impact level badge colors — copper/navy theme */
--impact-high:   #C0392B;   /* deep crimson */
--impact-medium: #D4860B;   /* amber */
--impact-low:    #6C757D;   /* muted slate */

/* Action type chip colors */
--type-approval:  #1A3A5C;  /* navy */
--type-reply:     #2E6B8A;  /* steel blue */
--type-blocker:   #8B1A1A;  /* dark red */
--type-event:     #2D6A4F;  /* forest green */
--type-delegated: #5C3D8F;  /* purple */
--type-awareness: #4A4A4A;  /* charcoal */

/* Escalation risk banner */
--risk-bg:        rgba(192, 57, 43, 0.08);
--risk-border:    rgba(192, 57, 43, 0.3);
```

---

## Action Type Display Labels

| `action_type` value | Display Label | Icon |
|---|---|---|
| `approval_required` | Approval Required | CheckCircle |
| `reply_needed` | Reply Needed | MessageSquare |
| `blocker` | Blocker | AlertTriangle |
| `event` | Event / Meeting | Calendar |
| `delegated_tracking` | Delegated | ArrowUpRight |
| `awareness` | For Your Awareness | Eye |

---

## Cluster Grouping Logic (App.jsx)

```javascript
// Group action cards by sender_organization
const clusters = tasks.reduce((acc, task) => {
  const key = task.sender_organization ?? 'Other';
  if (!acc[key]) acc[key] = [];
  acc[key].push(task);
  return acc;
}, {});

// Sort clusters: those with 'high' impact cards first
const sortedClusters = Object.entries(clusters).sort(([, a], [, b]) => {
  const rank = { high: 0, medium: 1, low: 2, null: 3 };
  const topA = Math.min(...a.map(t => rank[t.impact_level] ?? 3));
  const topB = Math.min(...b.map(t => rank[t.impact_level] ?? 3));
  return topA - topB;
});
```
