'use client';

import { SectionHeading } from './SectionHeading';
import { localized } from '@/lib/status';
import { formatTime, type Dict } from '@/lib/i18n';
import type { Announcement, AnnouncementLevel, Lang } from '@/lib/types';

const TONE: Record<AnnouncementLevel, string> = {
  info: 'border-l-accent',
  maintenance: 'border-l-status-degraded',
  incident: 'border-l-status-down',
};

export function Announcements({
  items,
  lang,
  dict,
}: {
  items: Announcement[];
  lang: Lang;
  dict: Dict;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <SectionHeading className="mb-2">{dict.announcements}</SectionHeading>

      <div className="space-y-2">
        {items.map((item) => {
          const body = localized(item.body, lang);
          return (
            <article
              key={item.id}
              className={`rounded-lg border border-l-4 border-line bg-surface px-4 py-3 ${TONE[item.level]}`}
            >
              {/* 狭い画面では日時を下に落とす。横並びのままだと見出しが不自然に折り返す */}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <h3 className="text-sm font-medium">{localized(item.title, lang)}</h3>
                <time
                  dateTime={item.publishedAt}
                  className="order-first shrink-0 text-xs tabular-nums text-fg-subtle sm:order-none"
                >
                  {formatTime(new Date(item.publishedAt), lang, true)}
                </time>
              </div>
              {body && (
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-fg-muted">
                  {body}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
