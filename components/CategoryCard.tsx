'use client';

import { ServiceRow } from './ServiceRow';
import { StatusIcon } from './StatusIcon';
import { localized, overallStatus, type RangeHours } from '@/lib/status';
import type { Dict } from '@/lib/i18n';
import type { Category, Lang, Service, StatusPayload } from '@/lib/types';

export function CategoryCard({
  category,
  services,
  payload,
  hours,
  lang,
  dict,
}: {
  category: Category;
  services: Service[];
  payload: StatusPayload;
  hours: RangeHours;
  lang: Lang;
  dict: Dict;
}) {
  const status = overallStatus(
    services.map((s) => payload.services[s.id]?.status ?? 'unknown')
  );
  const description = localized(category.description, lang);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <StatusIcon status={status} size={14} />
              <span className="truncate">{localized(category.name, lang)}</span>
            </h2>
            {description && (
              <p className="mt-1.5 pl-6 text-sm leading-relaxed text-fg-muted">
                {description}
              </p>
            )}
          </div>

          <span className="shrink-0 pt-0.5 text-xs text-fg-muted">
            {dict.status[status]}
          </span>
        </div>

        {/*
          カード全体をリンクにしない。
          稼働状況を確認しに来ただけの人が、誤ってサービス本体に飛ばされるのを防ぐ。
          遷移はこの明示的なリンクからのみ行う。
        */}
        {category.url && (
          <a
            href={category.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 ml-6 inline-flex items-center gap-1 rounded text-xs text-accent hover:underline"
          >
            {dict.openSite}
            <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
              <path d="M6 2h8v8h-2V5.4L5.4 12 4 10.6 10.6 4H6z" />
            </svg>
          </a>
        )}
      </header>

      <div className="divide-y divide-line px-4 sm:px-5">
        {services.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            entry={payload.services[service.id]}
            hours={hours}
            payload={payload}
            lang={lang}
            dict={dict}
          />
        ))}
      </div>
    </section>
  );
}
