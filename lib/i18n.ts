import type { Lang, ServiceStatus } from './types';

export const LANGS: Lang[] = ['ja', 'en'];
export const STORAGE_KEY_LANG = 'status-page:lang';
export const STORAGE_KEY_THEME = 'status-page:theme';

const dict = {
  ja: {
    siteTitle: 'サービス稼働状況',
    siteDescription:
      'はん（highemerly）が運営するサービス（個人が営む電気通信事業を含みます）の稼働状況一覧です。',
    contact: 'お問い合わせ',
    anchorLabel: 'このサービスへのリンク',
    allOperational: 'すべてのサービスが正常に稼働しています',
    someDegraded: '一部のサービスで問題が発生しています',
    majorOutage: 'サービスに障害が発生しています',
    statusUnknown: '稼働状況を取得できていません',
    asOf: '{time} 時点',
    loading: '読み込み中',
    loadError: '稼働状況を取得できませんでした',
    retry: '再読み込み',
    range: '表示期間',
    hours: '{n}時間',
    uptime: '稼働率',
    responseTime: '応答時間',
    noData: 'データなし',
    openSite: 'サイトを開く',
    announcements: 'お知らせ',
    olderFirst: '古い',
    newerLast: '新しい',
    theme: 'テーマ',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    themeSystem: 'システム設定',
    language: '言語',
    status: {
      up: '正常',
      degraded: '一部で問題',
      down: '停止',
      unknown: '不明',
    } as Record<ServiceStatus, string>,
    bucketTooltip: '{start} 〜 {end}',
    autoReload: '5分ごとに自動更新されます',
    version: 'バージョン',
    releaseNotes: 'リリースノート',
    currentStatus: '現在の状況',
    servicesHeading: 'サービス',
    legend: '凡例',
    showDetails: '内訳を見る',
    hideDetails: '内訳を閉じる',
    legendBar: 'バー1本は{minutes}分ぶんを表します。その間に一度でも問題があれば、悪いほうの色になります。',
  },
  en: {
    siteTitle: 'Service Status',
    siteDescription:
      'Operational status of services run by Han (highemerly), including telecommunications services operated as an individual.',
    contact: 'Contact',
    anchorLabel: 'Link to this service',
    allOperational: 'All services are operational',
    someDegraded: 'Some services are experiencing issues',
    majorOutage: 'Services are down',
    statusUnknown: 'Status is unavailable',
    asOf: 'As of {time}',
    loading: 'Loading',
    loadError: 'Could not load service status',
    retry: 'Reload',
    range: 'Time range',
    hours: '{n}h',
    uptime: 'Uptime',
    responseTime: 'Response',
    noData: 'No data',
    openSite: 'Open site',
    announcements: 'Announcements',
    olderFirst: 'Older',
    newerLast: 'Newer',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    language: 'Language',
    status: {
      up: 'Operational',
      degraded: 'Partial issues',
      down: 'Down',
      unknown: 'Unknown',
    } as Record<ServiceStatus, string>,
    bucketTooltip: '{start} – {end}',
    autoReload: 'Refreshes every 5 minutes',
    version: 'Version',
    releaseNotes: 'Release notes',
    currentStatus: 'Current status',
    servicesHeading: 'Services',
    legend: 'Legend',
    showDetails: 'Show breakdown',
    hideDetails: 'Hide breakdown',
    legendBar: 'Each bar covers {minutes} minutes. If anything went wrong during that window, the bar shows the worse state.',
  },
} as const;

export type Dict = (typeof dict)['ja'];

export function getDict(lang: Lang): Dict {
  return dict[lang] as Dict;
}

/** '{n}時間' のような単純な差し込み */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

export function formatTime(date: Date, lang: Lang, withDate = false): string {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** ブラウザの言語設定から初期値を決める */
export function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'ja';
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
