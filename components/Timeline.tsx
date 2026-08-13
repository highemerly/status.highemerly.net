'use client';

import { useMemo, useState } from 'react';
import { StatusIcon } from './StatusIcon';
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
  compact = false,
  uptime,
}: {
  history: string;
  hours: RangeHours;
  payload: Pick<StatusPayload, 'step' | 'to'>;
  lang: Lang;
  dict: Dict;
  /*
   * コンポーネント単位のバー。カテゴリ総合のバーより低くして、
   * 詳細を開いたときにどちらの粒度かひと目で分かるようにする。
   */
  compact?: boolean;
  /*
   * 稼働率。目盛りと同じ行の中央に出す。
   * バーの真下に置くと、その数字がどの期間を要約したものか位置で分かる。
   * compact のときは目盛りごと出さないので無視される。
   */
  uptime?: number | null;
}) {
  const buckets = useMemo(
    () => toBuckets(history, hours, payload),
    [history, hours, payload]
  );

  const [hovered, setHovered] = useState<number | null>(null);

  if (buckets.length === 0) {
    return <p className="text-xs text-fg-subtle">{dict.noData}</p>;
  }

  const withDate = hours >= 24;
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  // 期間を切り替えると本数が変わるので、範囲外になった添字は無効として扱う
  const active = hovered !== null && hovered < buckets.length ? buckets[hovered] : null;

  return (
    <div>
      <div className="relative" onPointerLeave={() => setHovered(null)}>
        {active && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1.5 flex items-center gap-1.5 whitespace-nowrap rounded border border-line bg-surface px-2 py-1 text-[11px] shadow-sm"
            style={tooltipPosition(hovered!, buckets.length)}
          >
            <span className="tabular-nums text-fg-muted">
              {fill(dict.bucketTooltip, {
                start: formatTime(active.start, lang, withDate),
                end: formatTime(active.end, lang, withDate),
              })}
            </span>
            <StatusIcon status={active.status} size={9} />
            <span className="text-fg">{dict.status[active.status]}</span>
          </div>
        )}

        <div className={`flex items-stretch gap-px ${compact ? 'h-3.5' : 'h-8'}`} role="img"
          aria-label={fill(dict.bucketTooltip, {
            start: formatTime(first.start, lang, withDate),
            end: formatTime(last.end, lang, withDate),
          })}
        >
          {buckets.map((bucket, i) => (
            <div
              key={i}
              className={`bar flex-1 ${BAR_COLOR[bucket.status]}`}
              onPointerEnter={() => setHovered(i)}
            />
          ))}
        </div>
      </div>

      {/* 目盛りはカテゴリ総合のバーにだけ出す。全行に同じ時刻が並ぶと読みにくい */}
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-fg-subtle">
          <span>{formatTime(first.start, lang, withDate)}</span>

          {/* 時刻より少しだけ強くする。同じ濃さだと 3 つめの時刻に見える */}
          {uptime !== null && uptime !== undefined && (
            <span title={dict.uptime} className="font-medium text-fg-muted">
              {uptime.toFixed(uptime === 100 ? 0 : 2)}%
            </span>
          )}

          <span>{formatTime(last.end, lang, withDate)}</span>
        </div>
      )}
    </div>
  );
}

/*
 * ツールチップの水平位置。
 * 基本はバーの中央に置くが、両端では画面外に出るので端に寄せる。
 */
function tooltipPosition(index: number, total: number): React.CSSProperties {
  const center = ((index + 0.5) / total) * 100;
  if (center < 20) return { left: 0 };
  if (center > 80) return { right: 0 };
  return { left: `${center}%`, transform: 'translateX(-50%)' };
}
