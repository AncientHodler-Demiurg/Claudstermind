import type { Config } from 'tailwindcss';

// HIVE INTELLIGENCE SYSTEMS — Tailwind v3 configuration.
// Cold, precise palette inspired by command-and-control interfaces.
// Deep navy-black background, teal accent for active intelligence,
// amber for warnings, red for critical alerts.
const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hive: {
          bg: '#06090f',
          surface: '#0c1220',
          elevated: '#111a2e',
          border: '#1e2d4a',
          'border-bright': '#2a3f66',
          muted: '#475569',
          text: '#e2e8f0',
          'text-secondary': '#94a3b8',
          gold: '#14b8a6',
          accent: '#14b8a6',
          'accent-dim': 'rgba(20, 184, 166, 0.15)',
          amber: '#f59e0b',
          'amber-dim': 'rgba(245, 158, 11, 0.15)',
          danger: '#ef4444',
          'danger-dim': 'rgba(239, 68, 68, 0.15)',
          success: '#22c55e',
          'success-dim': 'rgba(34, 197, 94, 0.15)',
        },
      },
      screens: {
        '3xl': '1440px',
      },
      fontFamily: {
        display: ['Rajdhani', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Outfit', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
