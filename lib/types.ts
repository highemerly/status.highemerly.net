export type ServiceStatus = 'up' | 'degraded' | 'down' | 'unknown';

export type Lang = 'ja' | 'en';

/** 日本語のみの文字列、または日英を持つオブジェクト */
export type Localized = string | Partial<Record<Lang, string>>;

/* ------------------------------------------------------------------ *
 * config/services.json
 * ------------------------------------------------------------------ */

export interface Category {
  id: string;
  name: Localized;
  description?: Localized;
  url?: string;
  /** バージョンの取得元。使うのは scripts/build-versions.js のみ */
  version?: CategoryVersionSpec;
}

export interface CategoryVersionSpec {
  /** k8s リポジトリ内の本番マニフェストへのパス */
  manifest: string;
  /** タグを取り出す対象のイメージ名 */
  image: string;
  /** タグから表示用バージョンを抜き出す正規表現 */
  displayPattern?: string;
  releases?: { repo: string; tagPrefix?: string };
}

export interface Service {
  id: string;
  name: Localized;
  categoryId: string;
  prometheusQuery: string | string[];
  /** レスポンスタイム用のクエリ。省略時はメトリック名から自動導出 */
  latencyQuery?: string;
}

export interface ServicesConfig {
  categories: Category[];
  services: Service[];
}

/* ------------------------------------------------------------------ *
 * data/status.v1.json（Lambda が生成）
 * ------------------------------------------------------------------ */

export interface ServiceStatusEntry {
  status: ServiceStatus;
  /** レスポンスタイム（ミリ秒）。取得できなければ存在しない */
  ms?: number;
  /** 履歴。1 文字 = 1 点（'1'=up / 'd'=degraded / '0'=down / '-'=unknown） */
  h: string;
}

export interface StatusPayload {
  v: 1;
  updatedAt: string;
  /** 履歴 1 点あたりの秒数（300 = 5 分） */
  step: number;
  /** 履歴の点数 */
  points: number;
  /** 履歴の先頭の時刻 */
  from: string;
  /** 履歴の末尾の時刻 */
  to: string;
  services: Record<string, ServiceStatusEntry>;
}

/* ------------------------------------------------------------------ *
 * お知らせ
 * ------------------------------------------------------------------ */

export type AnnouncementLevel = 'info' | 'maintenance' | 'incident';

export interface Announcement {
  id: string;
  categoryId?: string;
  level: AnnouncementLevel;
  title: Localized;
  body?: Localized;
  publishedAt: string;
}

export interface AnnouncementsPayload {
  announcements: Announcement[];
}

/* ------------------------------------------------------------------ *
 * config/versions.json（scripts/build-versions.js が生成）
 * ------------------------------------------------------------------ */

export interface VersionEntry {
  /** 表示用のバージョン */
  version: string;
  /** マニフェストに書かれている実際のイメージタグ */
  imageTag: string;
  /** リリースを切っていないサービスでは存在しない */
  release?: {
    name: string;
    url: string;
    publishedAt: string;
  };
}

export interface VersionsPayload {
  updatedAt: string;
  categories: Record<string, VersionEntry>;
}
