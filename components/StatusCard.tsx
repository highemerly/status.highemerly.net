import { ServiceStatusData } from '@/lib/types';
import StatusBadge from './StatusBadge';
import StatusHistoryBar from './StatusHistoryBar';

interface StatusCardProps {
  service: {
    id: string;
    name: string;
  };
  statusData?: ServiceStatusData;
}

export default function StatusCard({ service, statusData }: StatusCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5">
      {/* Service name and badge */}
      <div className="flex items-center gap-2 mb-1">
        <StatusBadge status={statusData?.status || 'unknown'} size="xs" />
        <h4 className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
          {service.name}
        </h4>
      </div>

      {/* Status History - full width, aligned with category bar */}
      <div className="w-full">
        {statusData?.history && statusData.history.length > 0 ? (
          <StatusHistoryBar history={statusData.history} size="sm" showLegend={false} />
        ) : (
          <div className="text-xs text-gray-400">No history available</div>
        )}
      </div>
    </div>
  );
}
