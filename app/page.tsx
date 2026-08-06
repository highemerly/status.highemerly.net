'use client';

import { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { OverallBanner } from '@/components/OverallBanner';
import { RangeSelector } from '@/components/RangeSelector';
import { CategoryCard } from '@/components/CategoryCard';
import { Announcements } from '@/components/Announcements';
import { usePreferences } from '@/lib/usePreferences';
import { getDict } from '@/lib/i18n';
import { DEFAULT_RANGE, overallStatus, type RangeHours } from '@/lib/status';
import type {
  Announcement,
  AnnouncementsPayload,
  ServicesConfig,
  StatusPayload,
  VersionsPayload,
} from '@/lib/types';

const RELOAD_INTERVAL_MS = 5 * 60 * 1000;

export default function HomePage() {
  const { lang, setLang, theme, setTheme, ready } = usePreferences();
  const dict = getDict(lang);

  const [range, setRange] = useState<RangeHours>(DEFAULT_RANGE);
  const [config, setConfig] = useState<ServicesConfig | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [versions, setVersions] = useState<VersionsPayload['categories']>({});
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      // 設定と稼働状況は必須。お知らせは無くても画面は成立する
      const [configRes, statusRes] = await Promise.all([
        fetch('/config/services.json'),
        fetch('/data/status.json'),
      ]);
      if (!configRes.ok || !statusRes.ok) throw new Error('fetch failed');

      setConfig(await configRes.json());
      setStatus(await statusRes.json());
      setFailed(false);
    } catch {
      setFailed(true);
      return;
    }

    // お知らせとバージョンは補足情報。取れなくても稼働状況は表示する
    try {
      const res = await fetch('/data/announcements.json');
      if (res.ok) {
        const payload: AnnouncementsPayload = await res.json();
        setAnnouncements(payload.announcements ?? []);
      }
    } catch {
      /* 無視 */
    }

    try {
      const res = await fetch('/config/versions.json');
      if (res.ok) {
        const payload: VersionsPayload = await res.json();
        setVersions(payload.categories ?? {});
      }
    } catch {
      /* 無視 */
    }
  }, []);

  useEffect(() => {
    load();

    // ページ全体をリロードせず、データだけ取り直す。
    // 表示期間やスクロール位置が保たれる。
    const timer = setInterval(load, RELOAD_INTERVAL_MS);

    // タブに戻ってきたら、次の定期更新を待たずに追いつく
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const overall = status
    ? overallStatus(Object.values(status.services).map((s) => s.status))
    : 'unknown';

  return (
    <main className="mx-auto max-w-page px-4 py-8 sm:py-12">
      {/* 設定を読む前に描画すると言語がちらつくので、確定するまで中身を出さない */}
      <div className={ready ? '' : 'invisible'}>
        <Header
          lang={lang}
          onLangChange={setLang}
          theme={theme}
          onThemeChange={setTheme}
          dict={dict}
        />

        <div className="mt-6 space-y-6">
          {failed && (
            <div className="rounded-lg border border-status-down/40 bg-status-down/10 px-4 py-4">
              <p className="text-sm font-medium">{dict.loadError}</p>
              <button
                type="button"
                onClick={load}
                className="mt-2 rounded border border-line bg-surface px-3 py-1 text-xs hover:bg-surface-raised"
              >
                {dict.retry}
              </button>
            </div>
          )}

          {!status && !failed && (
            <p className="py-16 text-center text-sm text-fg-subtle">{dict.loading}…</p>
          )}

          {status && config && (
            <>
              <OverallBanner
                status={overall}
                updatedAt={status.updatedAt}
                lang={lang}
                dict={dict}
              />

              <Announcements items={announcements} lang={lang} dict={dict} />

              <div className="flex justify-end">
                <RangeSelector value={range} onChange={setRange} dict={dict} />
              </div>

              <div className="space-y-4">
                {config.categories.map((category) => (
                  <CategoryCard
                    key={category.id}
                    category={category}
                    services={config.services.filter(
                      (s) => s.categoryId === category.id
                    )}
                    payload={status}
                    version={versions[category.id]}
                    hours={range}
                    lang={lang}
                    dict={dict}
                  />
                ))}
              </div>

              <p className="pt-2 text-center text-xs text-fg-subtle">
                {dict.autoReload}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
