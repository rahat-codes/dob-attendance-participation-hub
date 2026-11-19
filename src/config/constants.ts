/**
 * Central Configuration & Domain Constants
 * Den of Builders (DoB) - Attendance & Participation Hub
 */

// Super Administrator
export const SUPER_ADMIN_EMAIL = 'rahatmdmahadihasan@gmail.com';

// Timezone & Localization
export const DEFAULT_CLUB_TIMEZONE = 'Asia/Seoul';
export const DEFAULT_LOCALE = 'en-US';

// Check-In Windows & Rules
export const DEFAULT_CHECKIN_SETTINGS = {
  openMinutesBefore: 15,
  graceMinutesAfter: 30,
  lateAfterMinutes: 10,
  points: 10,
  defaultPoints: 10,
} as const;

// Kiosk Token Security
export const TOKEN_ROTATION_SECONDS = 45;
export const TOKEN_GRACE_SECONDS = 30; // previous token stays valid for 30s after rotation
export const TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Unambiguous: No 0/O/1/I/L
export const TOKEN_LENGTH = 8;

// Branding & Metadata
export const BRAND = {
  name: 'Den of Builders',
  shortName: 'DoB',
  hubTitle: 'Den of Builders – Attendance & Participation Hub',
  tagline: 'Hardware clinics, systems hack nights & builder sprints',
  accentColor: '#b5ff00',
  logoUrl: '/logo.svg',
  faviconUrl: '/favicon.svg',
} as const;

// Builder Track Taxonomy
export const BUILDER_TRACKS = [
  'Hardware & Robotics',
  'Software & Systems',
  'AI & Embedded',
  'Open Hack & Demo',
] as const;

// Executive Ranks
export const BUILDER_ROLES = [
  'Member',
  'Project Leader',
  'Vice President',
  'President',
] as const;

// Client & Security Rules Compatibility Version
export const CLIENT_SCHEMA_VERSION = '2026.11.v3-profile-fix';
export const EXPECTED_RULES_VERSION = '2026.11.v3';

