import { ServiceStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: ServiceStatus;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const statusConfig = {
  up: {
    label: 'Operational',
    color: 'bg-status-up text-white',
    dotColor: 'bg-status-up',
  },
  down: {
    label: 'Down',
    color: 'bg-status-down text-white',
    dotColor: 'bg-status-down',
  },
  degraded: {
    label: 'Degraded',
    color: 'bg-status-degraded text-white',
    dotColor: 'bg-status-degraded',
  },
  unknown: {
    label: 'Unknown',
    color: 'bg-status-unknown text-white',
    dotColor: 'bg-status-unknown',
  },
};

const sizeConfig = {
  xs: {
    text: 'text-[10px]',
    padding: 'px-1.5 py-px',
    dot: 'w-1 h-1',
  },
  sm: {
    text: 'text-xs',
    padding: 'px-2 py-0.5',
    dot: 'w-1.5 h-1.5',
  },
  md: {
    text: 'text-sm',
    padding: 'px-3 py-1',
    dot: 'w-2 h-2',
  },
  lg: {
    text: 'text-base',
    padding: 'px-4 py-1.5',
    dot: 'w-2.5 h-2.5',
  },
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status];
  const sizeStyles = sizeConfig[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.color} ${sizeStyles.padding} ${sizeStyles.text}`}
    >
      <span className={`rounded-full bg-white ${sizeStyles.dot} animate-pulse-dot`} />
      {config.label}
    </span>
  );
}
