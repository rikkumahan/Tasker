# Tasker AI — Design System Reference

> **Single source of truth** for colors, typography, spacing, components, and motion.
> Apply every token from this file — never invent values outside it.

---

## 1. Brand Identity

### Logo Mark — Dot Grid T
- A 3×3 knowledge matrix. **5 filled T-positions** + **4 ghost outlines**.
- `viewBox="0 0 240 240"` | cols: `60 / 120 / 180` | rows: `82 / 132 / 178`

| Mode | Filled dots | Ghost dots |
|---|---|---|
| **Light** | `fill: #111827` `r: 16` | `stroke: #111827` `stroke-width: 2.5` `opacity: 0.35` |
| **Dark** | `fill: white` | `stroke: white` `opacity: 0.35` |

### Wordmark
```
Tasker<span color="#F2673C">AI</span>
```
- "Tasker" in `#111827` / "AI" always in `#F2673C`

### Logo Rules
| ✅ DO | ❌ DON'T |
|---|---|
| Use mark on white or `#111827` only | Place on colored/gradient backgrounds |
| Maintain 16px clear space | Recolor filled dots to orange/gradient |
| Use "AI" in `#F2673C` in wordmark only | Stretch, rotate, or skew the mark |

---

## 2. Color Tokens

### Brand — Orange
| Token | Value | Usage |
|---|---|---|
| `--accent` | `#F2673C` | Nav active, left borders, badges, mark dots |
| `--grad-logo` | `135deg, #F2673C → #ea580c` | "Brief Me" CTA button, brand gradient |
| `--cta` | `#FB923C` | Solid action buttons ("Take Action", "Use Reply") |
| `--warm-surface` | `#FFF8F5` | AI panel card bg, warm-tinted surfaces |
| `--warm-border` | `#FFE4D9` | AI card borders |

### Surfaces
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#F8FAFC` | Page background |
| `--surface` | `#ffffff` | Cards, panels |
| `--surface-warm` | `#F1F5F9` | Selected rows, active nav background |
| `--surface-neutral` | `#F9FAFB` | Snooze buttons, people chips |
| `--border` | `#E5E7EB` | Default card outlines, dividers |

### Text
| Token | Value | Usage |
|---|---|---|
| `--fg` | `#111827` | Headings, primary body |
| `--fg-2` | `#374151` | Secondary labels, section text |
| `--muted` | `#6B7280` | Meta, timestamps, table headers |

### Semantic
| Token | Value | Usage |
|---|---|---|
| `--success` | `#16a34a` | Completed, "On Track" badge |
| `--warn` | `#f59e0b` | High priority, "Needs Attention" |
| `--danger` | `#ef4444` | Urgent priority, "At Risk" |

### Priority Palette
| Level | Background | Text Color |
|---|---|---|
| **Urgent** | `#fff1f2` | `#dc2626` |
| **High** | `#fffbeb` | `#d97706` |
| **Medium** | `#f0fdf4` | `#16a34a` |
| **Low** | `#F0FDF4` | `#16A34A` |

---

## 3. Typography

### Font Stack
- **Display / Headings / Wordmark** → `Plus Jakarta Sans`
- **Body / UI / Labels** → `Inter`
- **Code / Token names / Specs** → `DM Mono`

### Type Scale
| Token | Size | Font | Weight | Usage |
|---|---|---|---|---|
| `--text-2xl` | `36–48px` | Plus Jakarta Sans | `800` ExtraBold | Hero greeting, daily brief display |
| `--text-xl` | `24px` | Plus Jakarta Sans | `700` Bold | Page title, section headings |
| `--text-base` | `16px` | Plus Jakarta Sans | `700` Bold | Card titles, sub-headings |
| `--text-sm` | `14px` | Inter | `400` / `500` | Body, task text, list items, email subjects |
| `--text-xs` | `12px` | Inter | `600` / `700` | Badges, timestamps, labels, nav counts |
| `--text-mono` | `11px` | DM Mono | `400` | Token names, code values, specs |

### Font Weights
| Value | Name | Usage |
|---|---|---|
| `400` | Regular | Body, secondary text |
| `500` | Medium | Emphasized body, meta |
| `600` | Semibold | Labels, buttons, badges |
| `700` | Bold | Headings, active nav, selected row subject |
| `800` | ExtraBold | Display headings only |

### Tracking (Letter Spacing)
| Context | Value |
|---|---|
| Display headings | `-0.03em` to `-0.04em` |
| Section headings | `-0.025em` |
| Section labels (caps) | `+0.07em` to `+0.1em` |

### Line Height
| Context | Value |
|---|---|
| Display headings | `1.05–1.10` |
| Body text | `1.52` |

---

## 4. Spacing — 8pt Grid

| Token | Value | Usage |
|---|---|---|
| `--space-1` | `4px` | Icon gap, tight badge padding |
| `--space-2` | `8px` | Chip padding, row meta gaps |
| `--space-3` | `12px` | Sidebar horizontal padding, nav item padding |
| `--space-4` | `16px` | Table row padding, card baseline |
| `--space-5` | `20px` | Section header margin, metric card padding |
| `--space-6` | `24px` | Sidebar padding, logo zone |
| `--space-8` | `32px` | Section-to-section, main content padding |

---

## 5. Border Radius

| Token | Value | Usage |
|---|---|---|
| *(inline)* | `6–8px` | Inline buttons, checkboxes |
| `--radius-sm` | `10px` | Nav items, token cards, AI panel cards |
| `--radius-md` | `16px` | Tables, large cards |
| `--radius-pill` | `9999px` | Badges, chips, counts |

---

## 6. Elevation

| Token | Value | Usage |
|---|---|---|
| `--elev-ring` | `0 0 0 1px var(--border)` | Default card outline |
| `--elev-raised` | `0 4px 16px rgba(0,0,0,.07)` | Raised elements, dropdowns |
| `--elev-panel` | `0 8px 32px peach + inset top highlight` | Daily Brief hero card |
| **Sidebar Glass** | `bg: rgba(255,255,255,0.76)` + `blur(20px)` + `border: rgba(230,180,150,0.28)` | Sidebar/nav shell |

---

## 7. Motion

| Token | Value | Usage |
|---|---|---|
| `--motion-fast` | `150ms` | Hover bg, icon color, nav swap |
| `--motion-base` | `240ms` | Progress bar, selected row, panel slide |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | All transitions — fast start, gentle settle |

---

## 8. Components

### Buttons

#### Primary — "Brief Me" CTA
```css
background: linear-gradient(135deg, #F2673C, #ea580c);
font: 600 14px "Plus Jakarta Sans";
border-radius: 8px;
color: white;
/* includes Dot Grid T icon mark */
```

#### Solid CTA — "Take Action" / "Use Reply"
```css
background: #FB923C;
font: 600 14px Inter;
color: white;
border-radius: 8px;
```

#### Secondary — "Sync" / "Snooze" / "Reply →"
```css
background: white;
border: 1px solid #E5E7EB;
color: #374151;
font: 600 14px Inter;
border-radius: 8px;
```

---

### Badges

#### Pill Style (soft)
```css
font: 600 12px Inter;
border-radius: 9999px;
padding: 3px 10px;
background: <tinted>;  /* e.g. #fff1f2 for urgent */
color: <semantic>;     /* e.g. #dc2626 for urgent */
```

#### Compact Style (outlined)
```css
font: 700 10px Inter;
text-transform: uppercase;
letter-spacing: 0.06em;
border-radius: 5px;
border: 1px solid <semantic>;
padding: 2px 6px;
```

---

### Navigation (Sidebar / Tabs)

#### Active State
```css
border-left: 3px solid #F2673C;
background: #F1F5F9;
color: #F2673C;
font-weight: 700;
```

#### Inactive State
```css
border-left: 3px solid transparent;
background: transparent;
color: #374151;
font-weight: 400;
```

---

### Priority Row

#### Selected
```css
background: #F1F5F9;
border-left: 3px solid #F2673C;  /* inset indicator */
/* subject text weight: 600 */
```

#### Unselected
```css
background: transparent;
border-top: 1px solid #E5E7EB;
```

**Row anatomy:** Initials avatar · Subject text · Time tag · Sender name · Priority badge · Action button

---

### AI Summary Card
```css
/* Header label */
font: 600 12px Inter;
color: #374151;
letter-spacing: 0.01em;

/* Card box */
background: #FFF8F5;
border: 1px solid #FFE4D9;
border-radius: 10px;
padding: 14px;
```

---

### Daily Brief Hero
```css
/* Container */
background: linear-gradient(135deg, peach, lavender);
backdrop-filter: blur(16px);
box-shadow: 0 8px 32px rgba(242,103,60,0.18), inset 0 1px 0 rgba(255,255,255,0.5);

/* Nested metric cards (glass-in-glass) */
background: rgba(255,255,255,0.62);
backdrop-filter: blur(10px);
border-radius: 12px;

/* Metric values */
font: 800 36–48px "Plus Jakarta Sans";
```

---

## 9. Web Layout — Sidebar Glass Shell

```css
.sidebar {
  width: 240px;
  background: rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(20px);
  border-right: 1px solid rgba(230, 180, 150, 0.28);
  height: 100vh;
  position: fixed;
}

.main-content {
  margin-left: 240px;
  max-width: 1200px;
  padding: 32px;
  background: #F8FAFC;
}
```

---

## 10. Quick Reference Cheatsheet

```
ACCENT      #F2673C   ← logo, nav active, borders
GRAD        #F2673C → #ea580c 135deg
CTA SOLID   #FB923C
BG          #F8FAFC
SURFACE     #ffffff
SURFACE-W   #F1F5F9   ← selected rows
FG          #111827
FG-2        #374151
MUTED       #6B7280
SUCCESS     #16a34a
WARN        #f59e0b
DANGER      #ef4444

FONT-DISPLAY  Plus Jakarta Sans
FONT-BODY     Inter
FONT-MONO     DM Mono

MOTION-FAST   150ms
MOTION-BASE   240ms
EASE          cubic-bezier(0.2,0,0,1)

GRID          8pt base
RADIUS-SM     10px
RADIUS-MD     16px
RADIUS-PILL   9999px
```
