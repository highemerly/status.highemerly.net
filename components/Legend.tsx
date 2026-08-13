'use client';

import { StatusIcon } from './StatusIcon';
import { SectionHeading } from './SectionHeading';
import { bucketMinutes, type RangeHours } from '@/lib/status';
import { fill, type Dict } from '@/lib/i18n';
import type { ServiceStatus } from '@/lib/types';

const ORDER: ServiceStatus[] = ['up', 'degraded', 'down', 'unknown'];

const BAR_COLOR: Record<ServiceStatus, string> = {
  up: 'bg-status-up',
  degraded: 'bg-status-degraded',
  down: 'bg-status-down',
  unknown: 'bg-status-unknown/40',
};

export function Legend({
  hours,
  step,
  dict,
}: {
  hours: RangeHours;
  step: number;
  dict: Dict;
}) {
  return (
    <section>
      <SectionHeading className="mb-2.5">{dict.legend}</SectionHeading>

      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {ORDER.map((status) => (
          <li key={status} className="flex items-center gap-2 text-xs text-fg-muted">
            {/* バーの色と、行頭に出る形の両方を並べる。色だけでは区別できない人がいる */}
            <span className={`h-4 w-2 rounded-[1px] ${BAR_COLOR[status]}`} aria-hidden="true" />
            <StatusIcon status={status} size={11} />
            {dict.status[status]}
          </li>
        ))}
      </ul>

      {/*
        バーの読み方と更新間隔は、どちらも「このタイムラインをどう読むか」の話。
        更新間隔をフッターに置くとタイムラインから遠くて結び付かないので、ここに並べる。
      */}
      <p className="mt-2.5 text-xs leading-relaxed text-fg-subtle">
        {fill(dict.legendBar, { minutes: bucketMinutes(hours, step) })}
        {dict.autoReload}
      </p>
    </section>
  );
}
