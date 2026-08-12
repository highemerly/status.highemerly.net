'use client';

import { Timeline } from './Timeline';
import { StatusIcon } from './StatusIcon';
import { localized, uptime, type RangeHours } from '@/lib/status';
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
  const rate = entry ? uptime(entry.h, hours, payload.step) : null;

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={status} size={11} />
          <span className="truncate text-sm">{localized(service.name, lang)}</span>
        </div>

        {/* 数値は等幅にして、行ごとに桁がずれないようにする */}
        <div className="flex shrink-0 items-baseline gap-3 text-xs tabular-nums text-fg-muted">
          {entry?.ms !== undefined && (
            <span title={dict.responseTime}>{entry.ms}ms</span>
          )}
          {rate !== null && (
            <span title={dict.uptime} className="w-14 text-right">
              {rate.toFixed(rate === 100 ? 0 : 2)}%
            </span>
          )}
        </div>
      </div>

      {/* pl-5 はサービス総合のバー（CategoryCard）と同じ。左端を揃える */}
      <div className="mt-2 pl-5">
        {entry ? (
          <Timeline
            history={entry.h}
            hours={hours}
            payload={payload}
            lang={lang}
            dict={dict}
          />
        ) : (
          <p className="text-xs text-fg-subtle">{dict.noData}</p>
        )}
      </div>
    </div>
  );
}
