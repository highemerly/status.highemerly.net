'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEY_LANG, STORAGE_KEY_THEME, detectLang } from './i18n';
import type { Lang } from './types';

export type ThemeChoice = 'light' | 'dark' | 'system';

/**
 * 言語とテーマの設定。どちらも localStorage に保存する。
 *
 * 静的エクスポートのため、初期 HTML には設定が反映されていない。
 * 初回描画は既定値で行い、マウント後に保存値へ切り替える。
 * ちらつきを防ぐ実処理は layout.tsx の先行スクリプト側にある。
 */
export function usePreferences() {
  const [lang, setLangState] = useState<Lang>('ja');
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedLang = localStorage.getItem(STORAGE_KEY_LANG) as Lang | null;
    const storedTheme = localStorage.getItem(STORAGE_KEY_THEME) as ThemeChoice | null;

    setLangState(storedLang ?? detectLang());
    setThemeState(storedTheme ?? 'system');
    setReady(true);
  }, []);

  // system を選んでいる間は OS 設定の変更に追従する
  useEffect(() => {
    if (!ready) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };

    apply();
    if (theme !== 'system') return;

    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, ready]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = lang;
  }, [lang, ready]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY_LANG, next);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    if (next === 'system') localStorage.removeItem(STORAGE_KEY_THEME);
    else localStorage.setItem(STORAGE_KEY_THEME, next);
  }, []);

  return { lang, setLang, theme, setTheme, ready };
}
