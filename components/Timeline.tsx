'use client';

import { useMemo } from 'react';
import { toBuckets, type RangeHours } from '@/lib/status';
import { fill, formatTime, type Dict } from '@/lib/i18n';
import type { Lang, ServiceStatus, StatusPayload } from '@/lib/types';

const BAR_COLOR: Record<ServiceStatus, string> = {
  up: 'bg-status-up',
  degraded: 'bg-status-degraded',
  down: 'bg-status-down',
  unknown: 'bg-status-unknown/40',
};

export function Timeline({
  history,
  hours,
  payload,
  lang,
  dict,
}: {
  history: string;
  hours: RangeHours;
  payload: Pick<StatusPayload, 'step' | 'to'>;
  lang: Lang;
  dict: Dict;
}) {
  const buckets = useMemo(
    () => toBuckets(history, hours, payload),
    [history, hours, payload]
  );

  if (buckets.length === 0) {
    return <p className="text-xs text-fg-subtle">{dict.noData}</p>;
  }

  const withDate = hours >= 24;
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <div>
      <div className="flex h-8 items-stretch gap-px" role="img"
        aria-label={fill(dict.bucketTooltip, {
          start: formatTime(first.start, lang, withDate),
          end: formatTime(last.end, lang, withDate),
        })}
      >
        {buckets.map((bucket, i) => (
          <div
            key={i}
            className={`bar flex-1 ${BAR_COLOR[bucket.status]}`}
            title={`${fill(dict.bucketTooltip, {
              start: formatTime(bucket.start, lang, withDate),
              end: formatTime(bucket.end, lang, withDate),
            })}  ${dict.status[bucket.status]}`}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-fg-subtle">
        <span>{formatTime(first.start, lang, withDate)}</span>
        <span>{formatTime(last.end, lang, withDate)}</span>
      </div>
    </div>
  );
}
