'use client';

import type { ThemeChoice } from '@/lib/usePreferences';
import type { Dict } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

const THEME_ORDER: ThemeChoice[] = ['light', 'dark', 'system'];

const THEME_ICON: Record<ThemeChoice, React.ReactNode> = {
  light: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 0v2M8 14v2M0 8h2M14 8h2M2.3 2.3l1.4 1.4M12.3 12.3l1.4 1.4M13.7 2.3l-1.4 1.4M3.7 12.3l-1.4 1.4" />,
  dark: <path d="M13 9.5A5.6 5.6 0 0 1 6.5 3 5.8 5.8 0 1 0 13 9.5Z" />,
  system: <path d="M2 3h12v8H2zM6 13h4M8 11v2" />,
};

export function Header({
  lang,
  onLangChange,
  theme,
  onThemeChange,
  dict,
}: {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  dict: Dict;
}) {
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const themeLabel = {
    light: dict.themeLight,
    dark: dict.themeDark,
    system: dict.themeSystem,
  }[theme];

  return (
    <header>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {dict.siteTitle}
        </h1>

        <div className="flex shrink-0 items-center gap-1.5">
        {/* 言語は 2 つだけなのでトグルにする */}
        <div
          role="group"
          aria-label={dict.language}
          className="inline-flex rounded-md border border-line bg-surface p-0.5"
        >
          {(['ja', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onLangChange(code)}
              aria-pressed={lang === code}
              className={`rounded px-2 py-1 text-xs uppercase transition-colors ${
                lang === code
                  ? 'bg-surface-raised font-medium text-fg'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              {code}
            </button>
          ))}
        </div>

        {/* ライト → ダーク → システム設定 の順に切り替える */}
        <button
          type="button"
          onClick={() => onThemeChange(nextTheme)}
          title={`${dict.theme}: ${themeLabel}`}
          aria-label={`${dict.theme}: ${themeLabel}`}
          className="rounded-md border border-line bg-surface p-1.5 text-fg-muted transition-colors hover:text-fg"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {THEME_ICON[theme]}
          </svg>
        </button>
        </div>
      </div>

      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
        {dict.siteDescription}
      </p>
    </header>
  );
}
