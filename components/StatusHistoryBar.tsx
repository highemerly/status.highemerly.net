'use client';

import { StatusHistoryPoint } from '@/lib/types';
import { useState } from 'react';

interface StatusHistoryBarProps {
  history: StatusHistoryPoint[];
  size?: 'sm' | 'md';
  showLegend?: boolean;
}

export default function StatusHistoryBar({ history, size = 'md', showLegend = true }: StatusHistoryBarProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!history || history.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No history data available
      </div>
    );
  }

  // Sort by timestamp (oldest to newest)
  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calculate time range
  const startTime = new Date(sortedHistory[0].timestamp);
  const endTime = new Date(sortedHistory[sortedHistory.length - 1].timestamp);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          {startTime.toLocaleString('ja-JP', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span>直近3時間</span>
        <span>
          {endTime.toLocaleString('ja-JP', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      <div className="relative">
        <div className={`flex items-center gap-0.5 ${size === 'sm' ? 'h-5' : 'h-8'} bg-gray-100 dark:bg-gray-700 rounded`}>
          {sortedHistory.map((point, index) => {
            const statusColors = {
              up: 'bg-status-up',
              down: 'bg-status-down',
              degraded: 'bg-status-degraded',
              unknown: 'bg-status-unknown',
            };

            const color = statusColors[point.status];
            const width = `${100 / sortedHistory.length}%`;
            const isHovered = hoveredIndex === index;

            return (
              <div
                key={index}
                className={`h-full ${color} cursor-pointer transition-opacity ${
                  isHovered ? 'opacity-80' : ''
                }`}
                style={{ width }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Tooltip on hover */}
                {isHovered && (
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
                    <div className="font-semibold mb-1">
                      {new Date(point.timestamp).toLocaleString('ja-JP', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div>Status: <span className="font-semibold">{point.status.toUpperCase()}</span></div>
                    <div>Value: <span className="font-semibold">{point.value}</span></div>
                    {/* Arrow */}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
                      <div className="border-4 border-transparent border-t-gray-900 dark:border-t-gray-800"></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-status-up rounded"></span>
            <span>Operational</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-status-degraded rounded"></span>
            <span>Partial Outage</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-status-down rounded"></span>
            <span>Down</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-status-unknown rounded"></span>
            <span>Unknown</span>
          </div>
        </div>
      )}
    </div>
  );
}
