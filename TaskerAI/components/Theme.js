// ─────────────────────────────────────────────────────────────────────────────
// THEME — Design tokens for TaskerAI
// ─────────────────────────────────────────────────────────────────────────────

export const T = {
  // Core palette
  bg: '#F8FAFC',
  surface: '#ffffff',
  fg: '#111827',
  fg2: '#374151',
  muted: '#6B7280',
  border: '#E5E7EB',
  borderSoft: '#F3F4F6',

  // Accent
  accent: '#F2673C',
  accentTint: 'rgba(242,103,60,0.12)',  // 12% tint — avatar bg, chip bg
  cta: '#FB923C',
  ctaHover: '#F97316',

  // Warm surfaces (AI Panel, reply cards)
  warmSurface: '#FFF8F5',
  warmBorder: '#FFE4D9',

  // Status
  success: '#16a34a',
  warn: '#f59e0b',
  danger: '#ef4444',

  // Semantic surfaces used by priority rows
  urgentBg: '#fff1f2',
  urgentFg: '#dc2626',
  highBg: '#fffbeb',
  highFg: '#d97706',
  mediumBg: '#f0fdf4',
  mediumFg: '#16a34a',

  // Hero gradient colors (peach → soft-purple → lavender)
  heroGrad: [
    'rgba(255,241,236,0.90)',
    'rgba(249,237,255,0.85)',
    'rgba(237,233,254,0.90)',
  ],

  // Logo gradient
  logoGrad: ['#F2673C', '#ea580c'],

  // Typography scale (sp / pt)
  textXs: 12,
  textSm: 14,
  textBase: 16,
  textLg: 18,
  textXl: 24,

  // Radii
  radiusSm: 10,
  radiusMd: 15,
  radiusLg: 24,
  radiusPill: 9999,

  // Spacing
  sp1: 4,
  sp2: 8,
  sp3: 12,
  sp4: 16,
  sp5: 20,
  sp6: 24,
  sp8: 32,

  // ── Web layout tokens (from DESIGN_SYSTEM.md) ────────────────────────────
  sidebarW: 240,   // sidebar fixed width
  drawerW: 480,   // AI panel right drawer width
  contentMaxW: 1200,  // main content max-width on web

  // Glass sidebar: rgba(255,255,255,0.76) + blur(20px) + warm border
  sidebarBg: 'rgba(255,255,255,0.76)',
  sidebarBorder: 'rgba(230,180,150,0.28)',

  // Android glass fallbacks
  glassFallbackBg: 'rgba(255,255,255,0.8)',
  glassFallbackBorder: 'rgba(255,255,255,0.9)',
  heroFallbackBg: 'rgba(255,255,255,0.35)',

  // Selected nav item background
  surfaceWarm: '#F1F5F9',
  // Hover background
  surfaceNeutral: '#F9FAFB',

  // Motion — from design sheet
  motionFast: 150,   // ms — hover bg, icon color, nav swap
  motionBase: 240,   // ms — panel slide, selected row
  ease: 'cubic-bezier(0.2,0,0,1)',
};

export const PRIORITY_MAP = {
  urgent: { bg: '#fff1f2', fg: '#dc2626', label: 'Urgent', dot: '#ef4444' },
  high: { bg: '#fffbeb', fg: '#d97706', label: 'High', dot: '#f59e0b' },
  medium: { bg: '#eff6ff', fg: '#2563eb', label: 'Medium', dot: '#3b82f6' },
  low: { bg: '#f0fdf4', fg: '#16a34a', label: 'Low', dot: '#16a34a' },
};

export const PRIORITY_PANEL_META = {
  urgent: { bg: '#FEF2F2', fg: '#DC2626', border: '#FECACA', label: 'URGENT' },
  high: { bg: '#FFF7ED', fg: '#EA580C', border: '#FED7AA', label: 'HIGH' },
  medium: { bg: '#EFF6FF', fg: '#2563EB', border: '#BFDBFE', label: 'MEDIUM' },
  low: { bg: '#F0FDF4', fg: '#16A34A', border: '#BBF7D0', label: 'LOW' },
};
