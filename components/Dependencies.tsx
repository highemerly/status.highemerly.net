'use client';

import { Fragment } from 'react';
import { SectionHeading } from './SectionHeading';
import { ExternalIcon } from './ExternalIcon';
import type { Dict } from '@/lib/i18n';

/**
 * 依存先のステータスページ。
 *
 * ここが落ちているときは、こちらの表示が正しくても原因は外にある。
 * 「監視」の AWS は観測側（Lambda / EventBridge）の足元なので、
 * 落ちるとデータの更新自体が止まる。用途が違うので分けて並べる。
 */
const DEPENDENCIES = [
  {
    label: 'dependenciesInfra',
    links: [
      { name: 'Vultr（Tokyo）', href: 'https://status.vultr.com/' },
      { name: 'Wasabi（Tokyo）', href: 'https://status.wasabi.com/' },
      { name: 'Cloudflare', href: 'https://www.cloudflarestatus.com/' },
    ],
  },
  {
    label: 'dependenciesMonitoring',
    links: [
      // AWS はグローバルのステータスページなのでリージョンを付けない
      { name: 'AWS', href: 'https://health.aws.amazon.com/health/status' },
      {
        name: 'WebArena（Tokyo）',
        href: 'https://support.nttpc.co.jp/csm?id=services_status&service_group=67b86c0a1b055010c640dc24cc4bcba1',
      },
    ],
  },
] as const;

export function Dependencies({ dict }: { dict: Dict }) {
  return (
    <section>
      <SectionHeading className="mb-2">{dict.dependencies}</SectionHeading>

      <p className="text-xs leading-relaxed text-fg-muted">{dict.dependenciesNote}</p>

      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs leading-relaxed">
        {DEPENDENCIES.map((group) => (
          <li key={group.label}>
            <span className="text-fg-subtle">{dict[group.label]}: </span>
            {group.links.map((link, i) => (
              <Fragment key={link.href}>
                {i > 0 && (
                  <span className="text-fg-subtle" aria-hidden="true">
                    {' · '}
                  </span>
                )}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded text-accent hover:underline"
                >
                  {link.name}
                  <ExternalIcon />
                </a>
              </Fragment>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
