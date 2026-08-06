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
    },
  },
  plugins: [],
}

export default config
