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
  const description = localized(service.description, lang);

  return (
    <div className="py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} size={12} />
            <span className="truncate text-sm font-medium">
              {localized(service.name, lang)}
            </span>
          </div>
          {description && (
            <p className="mt-0.5 pl-5 text-xs leading-relaxed text-fg-subtle">
              {description}
            </p>
          )}
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

      <div className="mt-2">
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
