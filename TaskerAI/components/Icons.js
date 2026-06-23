import React from 'react';
import Svg, { Path, Rect, Circle, Polygon } from 'react-native-svg';

export const IconToday = ({ size = 20, color = '#6B7280' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.5" />
    <Path d="M10 6.5v4l2.5 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const IconTasks = ({ size = 20, color = '#6B7280' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x="3" y="4" width="5" height="5" rx="1" stroke={color} strokeWidth="1.5" />
    <Path d="M4.5 6.5l1.5 1.5 2-2" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M11 6.5h6M11 13.5h6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Rect x="3" y="11" width="5" height="5" rx="1" stroke={color} strokeWidth="1.5" />
  </Svg>
);

export const IconWaiting = ({ size = 20, color = '#6B7280' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx="7.5" cy="6.5" r="2.5" stroke={color} strokeWidth="1.5" />
    <Path d="M3 16.5c0-2.761 2.015-5 4.5-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Circle cx="14" cy="13" r="3.5" stroke={color} strokeWidth="1.5" />
    <Path d="M14 11.5v2l1 1" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const IconProjects = ({ size = 20, color = '#6B7280' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x="3" y="3" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
    <Rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
    <Rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
    <Rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
  </Svg>
);

export const IconPeople = ({ size = 20, color = '#6B7280' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx="7.5" cy="7" r="3" stroke={color} strokeWidth="1.5" />
    <Path d="M2.5 17c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Path d="M13.5 5c1.38.447 2.5 1.62 2.5 3s-1.12 2.553-2.5 3M17.5 17c0-2.761-2.015-5-4.5-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const IconSparkle = ({ size = 16, color = '#F2673C' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M10 2.5l1.8 5.7 5.7 1.8-5.7 1.8L10 17.5l-1.8-5.7-5.7-1.8 5.7-1.8L10 2.5z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
  </Svg>
);

export const IconClose = ({ size = 14, color = '#9CA3AF' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M5 5l10 10M15 5L5 15" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
);

export const IconCopy = ({ size = 13, color = 'white' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x="7" y="7" width="10" height="10" rx="2" stroke={color} strokeWidth="1.5" />
    <Path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const IconCheck = ({ size = 10, color = 'white' }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
    <Path d="M2 6l3 3 5-5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconExternalLink = ({ size = 13, color = '#9CA3AF' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M11 3h6m0 0v6m0-6L8 12M6 5H4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const GmailIcon = ({ size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    <Path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z" />
    <Path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
    <Polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
    <Path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.301 8.228 8 7.298 8 4.924 8 3 9.924 3 12.298z" />
    <Path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C38.868 8.301 39.772 8 40.702 8 43.076 8 45 9.924 45 12.298z" />
  </Svg>
);
