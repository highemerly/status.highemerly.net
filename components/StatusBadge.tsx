import { StatusIcon } from './StatusIcon';
import type { Dict } from '@/lib/i18n';
import type { ServiceStatus } from '@/lib/types';

const TONE: Record<ServiceStatus, string> = {
  up: 'bg-status-up/10 text-status-up',
  degraded: 'bg-status-degraded/15 text-status-degraded',
  down: 'bg-status-down/15 text-status-down',
  unknown: 'bg-surface-raised text-fg-muted',
};

/**
 * ステータスの印。
 *
 * 同じ形をもう一枚重ねて広げながら消すことで、値が生きていることを示す。
 * 動きを減らす設定のブラウザでは globals.css 側で止まる。
 */
export function LiveDot({ status, size = 11 }: { status: ServiceStatus; size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <StatusIcon
        status={status}
        size={size}
        className="absolute inset-0 animate-status-ping"
      />
      <StatusIcon status={status} size={size} className="relative" />
    </span>
  );
}

export function StatusBadge({
  status,
  dict,
  size = 'md',
}: {
  status: ServiceStatus;
  dict: Dict;
  size?: 'md' | 'lg';
}) {
  const large = size === 'lg';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${TONE[status]} ${
        large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <LiveDot status={status} size={large ? 14 : 11} />
      {dict.status[status]}
    </span>
  );
}
