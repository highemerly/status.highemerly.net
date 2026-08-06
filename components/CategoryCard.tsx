'use client';

import { useState, useMemo } from 'react';
import { Category, Service, ServiceStatusData, ServiceStatus, StatusHistoryPoint, StatusOverride } from '@/lib/types';
import StatusBadge from './StatusBadge';
import StatusCard from './StatusCard';
import StatusHistoryBar from './StatusHistoryBar';

interface CategoryCardProps {
  category: Category;
  services: Service[];
  statusData: ServiceStatusData[];
  statusOverride?: StatusOverride;
}

function calculateCategoryStatus(
  services: Service[],
  statusData: ServiceStatusData[]
): ServiceStatus {
  const statuses = services.map((service) => {
    const status = statusData.find((s) => s.id === service.id);
    return status?.status || 'unknown';
  });

  const allUp = statuses.every((s) => s === 'up');
  const allDown = statuses.every((s) => s === 'down');
  const hasDown = statuses.some((s) => s === 'down');
  const hasDegraded = statuses.some((s) => s === 'degraded');
  const hasUnknown = statuses.some((s) => s === 'unknown');

  if (allUp) return 'up';
  if (allDown) return 'down';
  if (hasDown || hasDegraded || hasUnknown) return 'degraded';

  return 'unknown';
}

function calculateCategoryHistory(
  services: Service[],
  statusData: ServiceStatusData[]
): StatusHistoryPoint[] {
  // Get all service histories
  const serviceHistories = services
    .map((service) => {
      const status = statusData.find((s) => s.id === service.id);
      return status?.history || [];
    })
    .filter((history) => history.length > 0);

  if (serviceHistories.length === 0) return [];

  // Get all unique timestamps
  const timestampMap = new Map<string, ServiceStatus[]>();

  serviceHistories.forEach((history) => {
    history.forEach((point) => {
      if (!timestampMap.has(point.timestamp)) {
        timestampMap.set(point.timestamp, []);
      }
      timestampMap.get(point.timestamp)!.push(point.status);
    });
  });

  // Calculate category status for each timestamp
  const categoryHistory: StatusHistoryPoint[] = [];

  timestampMap.forEach((statuses, timestamp) => {
    const allUp = statuses.every((s) => s === 'up');
    const allDown = statuses.every((s) => s === 'down');
    const hasDown = statuses.some((s) => s === 'down');
    const hasUnknown = statuses.some((s) => s === 'unknown');

    let categoryStatus: ServiceStatus = 'unknown';
    if (allUp) categoryStatus = 'up';
    else if (allDown) categoryStatus = 'down';
    else if (hasDown || hasUnknown) categoryStatus = 'degraded';

    categoryHistory.push({
      timestamp,
      status: categoryStatus,
      value: allUp ? 1 : 0,
    });
  });

  return categoryHistory.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export default function CategoryCard({
  category,
  services,
  statusData,
  statusOverride,
}: CategoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // ステータスオーバーライドが存在する場合はそれを優先
  const categoryStatus = statusOverride
    ? (statusOverride.status === 'operational' ? 'up' : statusOverride.status === 'degraded' ? 'degraded' : 'down')
    : calculateCategoryStatus(services, statusData);

  const categoryHistory = useMemo(
    () => calculateCategoryHistory(services, statusData),
    [services, statusData]
  );

  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
      {/* Category Header */}
      <div
        className="bg-white dark:bg-gray-800 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Category Info Row */}
        <div className="flex items-center gap-2 mb-1.5">
          {/* Expand/Collapse Button - leftmost */}
          <button
            className="flex-shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            <svg
              className={`w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform ${
                isExpanded ? 'transform rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {/* Category name */}
          <div className="flex-1 min-w-0">
            {category.url ? (
              <a
                href={category.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                onClick={(e) => e.stopPropagation()}
              >
                {category.name}
              </a>
            ) : (
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                {category.name}
              </h2>
            )}
          </div>

          {/* Status badge - right aligned */}
          <StatusBadge status={categoryStatus} size="sm" />
        </div>

        {/* Category Status History - full width */}
        {categoryHistory.length > 0 && (
          <div className="w-full">
            <StatusHistoryBar history={categoryHistory} showLegend={false} />
          </div>
        )}

        {/* Description - shown below history bar when expanded */}
        {isExpanded && category.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {category.description}
          </p>
        )}
      </div>

      {/* Services List */}
      {isExpanded && (
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {services.map((service) => {
            const status = statusData.find((s) => s.id === service.id);
            return (
              <StatusCard key={service.id} service={service} statusData={status} />
            );
          })}
        </div>
      )}
    </div>
  );
}
