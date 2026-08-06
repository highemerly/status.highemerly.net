'use client';

import { RANGE_HOURS, type RangeHours } from '@/lib/status';
import { fill, type Dict } from '@/lib/i18n';

export function RangeSelector({
  value,
  onChange,
  dict,
}: {
  value: RangeHours;
  onChange: (hours: RangeHours) => void;
  dict: Dict;
}) {
  return (
    <div
      role="group"
      aria-label={dict.range}
      className="inline-flex rounded-md border border-line bg-surface p-0.5"
    >
      {RANGE_HOURS.map((hours) => {
        const selected = hours === value;
        return (
          <button
            key={hours}
            type="button"
            onClick={() => onChange(hours)}
            aria-pressed={selected}
            className={`rounded px-2.5 py-1 text-xs tabular-nums transition-colors ${
              selected
                ? 'bg-surface-raised font-medium text-fg'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {fill(dict.hours, { n: hours })}
          </button>
        );
      })}
    </div>
  );
}
