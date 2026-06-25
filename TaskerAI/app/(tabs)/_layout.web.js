// ─────────────────────────────────────────────────────────────────────────────
// (tabs)/_layout.web.js — Web tabs layout (no tab bar — sidebar handles nav)
// Just renders the current page via <Slot />.
// The WebShell sidebar is the navigation — we don't need a second tab bar.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Slot } from 'expo-router';

export default function WebTabLayout() {
  return <Slot />;
}
