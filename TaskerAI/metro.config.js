// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ── Fix: @supabase/realtime-js bundles its own `ws` package which pulls in
// multiple Node built-ins (stream, zlib, crypto, http, net…).
// React Native's runtime doesn't include Node built-ins, so Android/iOS
// bundling fails.
//
// Stubbing `ws` itself at the resolver level cuts the whole chain at once.
// On native, Supabase realtime uses the global native WebSocket that React
// Native exposes — the `ws` package is never actually invoked.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && moduleName === 'ws') {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
