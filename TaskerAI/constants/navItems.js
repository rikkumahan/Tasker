// ─────────────────────────────────────────────────────────────────────────────
// NAV_ITEMS — Single source of truth for all navigation
// Add new tab here → appears automatically in both Sidebar (web) and Tab bar (mobile)
// ─────────────────────────────────────────────────────────────────────────────

import {
  IconToday, IconTasks, IconWaiting, IconProjects, IconPeople,
} from '../components/Icons';

export const NAV_ITEMS = [
  { name: 'index',    label: 'Today',    Icon: IconToday,    href: '/',         badge: null },
  { name: 'tasks',    label: 'Tasks',    Icon: IconTasks,    href: '/tasks',    badge: null },
  { name: 'waiting',  label: 'Waiting',  Icon: IconWaiting,  href: '/waiting',  badge: 4    },
  { name: 'projects', label: 'Projects', Icon: IconProjects, href: '/projects', badge: null },
  { name: 'people',   label: 'People',   Icon: IconPeople,   href: '/people',   badge: null },
];
