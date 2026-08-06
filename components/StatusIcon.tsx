import type { ServiceStatus } from '@/lib/types';

const COLOR: Record<ServiceStatus, string> = {
  up: 'text-status-up',
  degraded: 'text-status-degraded',
  down: 'text-status-down',
  unknown: 'text-status-unknown',
};

/*
 * ステータスごとに形を変える。
 * 色だけで区別すると、赤緑の判別が難しい人には伝わらない。
 */
const PATH: Record<ServiceStatus, React.ReactNode> = {
  up: <circle cx="8" cy="8" r="5" />,
  degraded: <path d="M8 2.5 14 13H2z" />,
  down: <rect x="3" y="3" width="10" height="10" rx="1.5" />,
  unknown: <rect x="3" y="7" width="10" height="2" rx="1" />,
};

export function StatusIcon({
  status,
  size = 16,
  className = '',
}: {
  status: ServiceStatus;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={`${COLOR[status]} shrink-0 ${className}`}
    >
      {PATH[status]}
    </svg>
  );
}
