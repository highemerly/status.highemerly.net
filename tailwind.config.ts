import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    'bg-status-up',
    'bg-status-down',
    'bg-status-degraded',
    'bg-status-unknown',
    'text-status-up',
    'text-status-down',
    'text-status-degraded',
    'text-status-unknown',
  ],
  theme: {
    extend: {
      colors: {
        status: {
          up: '#10b981',
          down: '#ef4444',
          degraded: '#f59e0b',
          unknown: '#6b7280',
        },
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(1.1)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
export default config
