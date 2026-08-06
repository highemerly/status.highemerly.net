'use client';

import { StatusIcon } from './StatusIcon';
import { fill, formatTime, type Dict } from '@/lib/i18n';
import type { Lang, ServiceStatus } from '@/lib/types';

const HEADLINE: Record<ServiceStatus, keyof Dict> = {
  up: 'allOperational',
  degraded: 'someDegraded',
  down: 'majorOutage',
  unknown: 'statusUnknown',
};

const TONE: Record<ServiceStatus, string> = {
  up: 'border-status-up/30 bg-status-up/5',
  degraded: 'border-status-degraded/40 bg-status-degraded/10',
  down: 'border-status-down/40 bg-status-down/10',
  unknown: 'border-line bg-surface',
};

export function OverallBanner({
  status,
  updatedAt,
  lang,
  dict,
}: {
  status: ServiceStatus;
  updatedAt: string;
  lang: Lang;
  dict: Dict;
}) {
  return (
    <div className={`rounded-lg border px-4 py-4 sm:px-5 ${TONE[status]}`}>
      <div className="flex items-center gap-3">
        <StatusIcon status={status} size={20} />
        <p className="text-base font-semibold sm:text-lg">
          {dict[HEADLINE[status]] as string}
        </p>
      </div>
      <p className="mt-1.5 pl-8 text-xs tabular-nums text-fg-muted">
        {fill(dict.asOf, { time: formatTime(new Date(updatedAt), lang, true) })}
      </p>
    </div>
  );
}
