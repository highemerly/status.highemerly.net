'use client';

import { Timeline } from './Timeline';
import { StatusIcon } from './StatusIcon';
import { localized, type RangeHours } from '@/lib/status';
import type { Dict } from '@/lib/i18n';
import type { Lang, Service, ServiceStatusEntry, StatusPayload } from '@/lib/types';

export function ServiceRow({
  service,
  entry,
  hours,
  payload,
  lang,
  dict,
}: {
  service: Service;
  entry: ServiceStatusEntry | undefined;
  hours: RangeHours;
  payload: StatusPayload;
  lang: Lang;
  dict: Dict;
}) {
  const status = entry?.status ?? 'unknown';

  return (
    // pl-5 はカテゴリ総合のバー（CategoryCard）と同じ。名前もバーも左端を揃える
    <div className="py-3 pl-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={status} size={11} />
          <span className="truncate text-sm">{localized(service.name, lang)}</span>
        </div>

        {/*
          コンポーネント単位では稼働率を出さない。カテゴリ側の数字と紛らわしく、
          ここで知りたいのは「今どれくらい遅いか」なので応答時間だけにする。
          数値は等幅にして、行ごとに桁がずれないようにする
        */}
        {entry?.ms !== undefined && (
          <span
            title={dict.responseTime}
            className="shrink-0 text-xs tabular-nums text-fg-muted"
          >
            {entry.ms}ms
          </span>
        )}
      </div>

      <div className="mt-2">
        {entry ? (
          <Timeline
            history={entry.h}
            hours={hours}
            payload={payload}
            lang={lang}
            dict={dict}
            compact
          />
        ) : (
          <p className="text-xs text-fg-subtle">{dict.noData}</p>
        )}
      </div>
    </div>
  );
}
