import type { Config } from 'tailwindcss'

// 色は globals.css の CSS 変数で定義し、ここでは意味づけだけを行う。
// ライト / ダークの切り替えは変数の差し替えで完結する。
const withAlpha = (name: string) => `rgb(var(${name}) / <alpha-value>)`

const config: Config = {
  darkMode: 'class',
  content: [
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: withAlpha('--bg'),
        surface: withAlpha('--surface'),
        'surface-raised': withAlpha('--surface-raised'),
        line: withAlpha('--line'),
        fg: withAlpha('--fg'),
        'fg-muted': withAlpha('--fg-muted'),
        'fg-subtle': withAlpha('--fg-subtle'),
        accent: withAlpha('--accent'),
        status: {
          up: withAlpha('--status-up'),
          degraded: withAlpha('--status-degraded'),
          down: withAlpha('--status-down'),
          unknown: withAlpha('--status-unknown'),
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Hiragino Sans',
          'Hiragino Kaku Gothic ProN',
          'Noto Sans JP',
          'Meiryo',
          'sans-serif',
        ],
      },
      maxWidth: {
        page: '56rem',
      },
      // ステータス表示が「今この瞬間の値」であることを伝えるための脈動。
      // 広がって消える輪と、本体のわずかな伸縮を重ねる。
      keyframes: {
        'status-ping': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '75%, 100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        'status-breathe': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
        },
      },
      animation: {
        'status-ping': 'status-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'status-breathe': 'status-breathe 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
