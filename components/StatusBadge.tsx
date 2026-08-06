import { StatusIcon } from './StatusIcon';
import type { Dict } from '@/lib/i18n';
import type { ServiceStatus } from '@/lib/types';

const TONE: Record<ServiceStatus, string> = {
  up: 'bg-status-up/10 text-status-up',
  degraded: 'bg-status-degraded/15 text-status-degraded',
  down: 'bg-status-down/15 text-status-down',
  unknown: 'bg-surface-raised text-fg-muted',
};

const DOT_COLOR: Record<ServiceStatus, string> = {
  up: 'text-status-up',
  degraded: 'text-status-degraded',
  down: 'text-status-down',
  unknown: 'text-status-unknown',
};

/**
 * ステータスの印。
 *
 * 輪が広がって消える動きと、本体のわずかな伸縮を重ねて、値が生きていることを示す。
 * 輪はバッジの淡い背景より濃く出す。同系の薄さだと背景に埋もれて見えない。
 * 動きを減らす設定のブラウザでは globals.css 側で止まる。
 */
export function LiveDot({ status, size = 12 }: { status: ServiceStatus; size?: number }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${DOT_COLOR[status]}`}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 animate-status-ping rounded-full bg-current"
        aria-hidden="true"
      />
      <StatusIcon
        status={status}
        size={size}
        className="relative animate-status-breathe"
      />
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
        large ? 'px-3.5 py-1.5 text-base' : 'px-2.5 py-1 text-sm'
      }`}
    >
      <LiveDot status={status} size={large ? 16 : 13} />
      {dict.status[status]}
    </span>
  );
}
