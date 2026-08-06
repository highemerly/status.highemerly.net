'use client';

import { useMemo, useState } from 'react';
import { ServiceRow } from './ServiceRow';
import { StatusBadge } from './StatusBadge';
import { Timeline } from './Timeline';
import {
  localized,
  mergeHistories,
  overallStatus,
  uptime,
  type RangeHours,
} from '@/lib/status';
import type { Dict } from '@/lib/i18n';
import type {
  Category,
  Lang,
  Service,
  StatusPayload,
  VersionEntry,
} from '@/lib/types';

function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
      <path d="M6 2h8v8h-2V5.4L5.4 12 4 10.6 10.6 4H6z" />
    </svg>
  );
}

export function CategoryCard({
  category,
  services,
  payload,
  version,
  hours,
  lang,
  dict,
}: {
  category: Category;
  services: Service[];
  payload: StatusPayload;
  version?: VersionEntry;
  hours: RangeHours;
  lang: Lang;
  dict: Dict;
}) {
  // 一覧性を優先し、既定は閉じた状態。コンポーネント単位の内訳は開いたときだけ出す
  const [expanded, setExpanded] = useState(false);

  const status = overallStatus(
    services.map((s) => payload.services[s.id]?.status ?? 'unknown')
  );

  // 閉じているときに出す「サービス全体」のタイムライン。
  // 1 つでも落ちていればここに色が出るので、開かなくても異常に気づける。
  const merged = useMemo(
    () => mergeHistories(services.map((s) => payload.services[s.id]?.h ?? '')),
    [services, payload]
  );

  const rate = merged ? uptime(merged, hours, payload.step) : null;
  const description = localized(category.description, lang);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 rounded text-left"
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-fg-subtle transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          >
            <path d="m5 3 6 5-6 5" />
          </svg>

          <h3 className="min-w-0 flex-1 truncate text-base font-semibold">
            {localized(category.name, lang)}
          </h3>

          {/* 状態と稼働率は行を分ける。並べると数字がどちらの値か読み取りにくい */}
          <span className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={status} dict={dict} />
            {rate !== null && (
              <span className="text-xs tabular-nums text-fg-subtle">
                {rate.toFixed(rate === 100 ? 0 : 2)}%
              </span>
            )}
          </span>
        </button>

        {description && (
          <p className="mt-2 pl-5 text-sm leading-relaxed text-fg-muted">
            {description}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-5">
          {/*
            カード全体をリンクにしない。開閉はボタン、遷移はこのリンクだけ。
            稼働状況を見に来ただけの人が誤ってサービス本体に飛ぶのを防ぐ。
          */}
          {category.url && (
            <a
              href={category.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded text-xs text-accent hover:underline"
            >
              {dict.openSite}
              <ExternalIcon />
            </a>
          )}

          {/* 数字だけ置くと何の値か分からないので、必ずラベルを付ける */}
          {version && (
            <span className="text-xs text-fg-subtle">
              {dict.version}:{' '}
              {version.release ? (
                <a
                  href={version.release.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${dict.releaseNotes}（${version.imageTag}）`}
                  className="inline-flex items-center gap-1 rounded tabular-nums text-accent hover:underline"
                >
                  {version.version}
                  <ExternalIcon />
                </a>
              ) : (
                <span className="tabular-nums" title={version.imageTag}>
                  {version.version}
                </span>
              )}
            </span>
          )}
        </div>

        <div className="mt-3 pl-5">
          <Timeline
            history={merged}
            hours={hours}
            payload={payload}
            lang={lang}
            dict={dict}
          />
        </div>
      </div>

      {expanded && (
        <div className="divide-y divide-line border-t border-line bg-surface-raised/40 px-4 sm:px-5">
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
      )}
    </section>
  );
}
