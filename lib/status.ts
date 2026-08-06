import type { Lang, Localized, ServiceStatus, StatusPayload } from './types';

/** 履歴文字列の 1 文字 → ステータス */
const DECODE: Record<string, ServiceStatus> = {
  '1': 'up',
  d: 'degraded',
  '0': 'down',
  '-': 'unknown',
};

export const RANGE_HOURS = [1, 3, 12, 24, 48] as const;
export type RangeHours = (typeof RANGE_HOURS)[number];
export const DEFAULT_RANGE: RangeHours = 3;

/** 1 本のバーが表す情報 */
export interface Bucket {
  status: ServiceStatus;
  start: Date;
  end: Date;
  /** このバケットに含まれる点の内訳 */
  counts: Record<ServiceStatus, number>;
}

export function localized(value: Localized | undefined, lang: Lang): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  // 指定言語がなければ日本語、それもなければ空でなく英語にフォールバック
  return value[lang] ?? value.ja ?? value.en ?? '';
}

/**
 * 履歴文字列から、指定期間ぶんの末尾を切り出す。
 *
 * 48 時間分が 1 ファイルに入っているので、期間切替はここで完結する。
 * 追加のリクエストは発生しない。
 */
export function sliceRange(history: string, hours: RangeHours, step: number): string {
  const wanted = Math.round((hours * 3600) / step);
  return history.slice(-wanted);
}

/**
 * 履歴をバーに畳む。
 *
 * 48 時間 = 576 点をそのまま並べると 1 本が 1px 未満になって潰れるため、
 * 表示本数が収まるようにまとめる。1h / 3h は 1 本 = 5 分のまま。
 */
export function toBuckets(
  history: string,
  hours: RangeHours,
  payload: Pick<StatusPayload, 'step' | 'to'>,
  maxBars = 72
): Bucket[] {
  const sliced = sliceRange(history, hours, payload.step);
  const size = Math.ceil(sliced.length / maxBars);
  const endMs = new Date(payload.to).getTime();
  const stepMs = payload.step * 1000;

  // 末尾（最新）を基準に切るので、余りは先頭側に寄せる
  const buckets: Bucket[] = [];
  for (let i = 0; i < sliced.length; i += size) {
    const chunk = sliced.slice(i, i + size);
    const counts: Record<ServiceStatus, number> = { up: 0, degraded: 0, down: 0, unknown: 0 };
    for (const ch of chunk) counts[DECODE[ch] ?? 'unknown']++;

    // バケット内は「最も悪い状態」を代表にする。
    // 平均や多数決だと短時間の障害が消えてしまう。
    let status: ServiceStatus = 'unknown';
    if (counts.down > 0) status = 'down';
    else if (counts.degraded > 0) status = 'degraded';
    else if (counts.up > 0) status = 'up';

    // sliced の末尾が payload.to に対応する。
    // 各サンプルは「直前の step 秒間の状態」を表すものとして扱うので、
    // 区間は (最初のサンプル時刻 - step, 最後のサンプル時刻] になる。
    // こうしないと 3 時間表示が 2 時間 55 分になる。
    const start = new Date(endMs - (sliced.length - i) * stepMs);
    const end = new Date(endMs - (sliced.length - i - chunk.length) * stepMs);

    buckets.push({ status, start, end, counts });
  }

  return buckets;
}

/** 指定期間の稼働率（unknown は分母から除く） */
export function uptime(history: string, hours: RangeHours, step: number): number | null {
  const sliced = sliceRange(history, hours, step);
  let up = 0;
  let known = 0;
  for (const ch of sliced) {
    const s = DECODE[ch] ?? 'unknown';
    if (s === 'unknown') continue;
    known++;
    if (s === 'up') up++;
  }
  return known === 0 ? null : (up / known) * 100;
}

/** 複数サービスをまとめたときの全体ステータス */
export function overallStatus(statuses: ServiceStatus[]): ServiceStatus {
  const known = statuses.filter((s) => s !== 'unknown');
  if (known.length === 0) return 'unknown';
  if (known.some((s) => s === 'down')) {
    return known.every((s) => s === 'down') ? 'down' : 'degraded';
  }
  if (known.some((s) => s === 'degraded')) return 'degraded';
  return 'up';
}

export function decode(char: string): ServiceStatus {
  return DECODE[char] ?? 'unknown';
}
