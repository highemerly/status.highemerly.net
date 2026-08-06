import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'サービス稼働状況 / Service Status',
  description: 'はんドンクラブほか各サービスの稼働状況',
  icons: { icon: '/favicon.svg' },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e12' },
  ],
};

/*
 * テーマ適用を React のマウント前に済ませる。
 * 静的エクスポートなので初期 HTML は常に同じ。ここで先に class を付けないと、
 * ダーク設定のユーザーに白い画面が一瞬見える。
 */
const themeInit = `
(function () {
  try {
    var stored = localStorage.getItem('status-page:theme');
    var dark = stored === 'dark' ||
      (stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    var lang = localStorage.getItem('status-page:lang');
    if (lang) document.documentElement.lang = lang;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
