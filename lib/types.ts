// Service status types
export type ServiceStatus = 'up' | 'down' | 'degraded' | 'unknown';

// Category definition
export interface Category {
  id: string;
  name: string;
  description?: string;
  url?: string;
}

// Service definition
export interface Service {
  id: string;
  name: string;
  prometheusQuery: string | string[];
  categoryId: string;
}

// Status history point
export interface StatusHistoryPoint {
  timestamp: string;
  status: ServiceStatus;
  value: number;
}

// Service status data
export interface ServiceStatusData {
  id: string;
  status: ServiceStatus;
  responseTime?: number;
  uptime?: number;
  lastChecked: string;
  incidents: Incident[];
  history?: StatusHistoryPoint[];
}

// Incident
export interface Incident {
  id: string;
  serviceId: string;
  startTime: string;
  endTime?: string;
  description: string;
  severity: 'minor' | 'major' | 'critical';
}

// Prometheus configuration
export interface PrometheusConfig {
  url: string;
  auth?: {
    username: string;
    password: string;
  };
  cacheMaxAge: number;
}

// Discord configuration
export interface DiscordConfig {
  webhookSecret: string;
}

// Application configuration
export interface AppConfig {
  categories: Category[];
  services: Service[];
  prometheus: PrometheusConfig;
  discord: DiscordConfig;
}

// Status cache structure
export interface StatusCache {
  lastUpdate: string;
  services: ServiceStatusData[];
}

// Admin message types
export type MessageType = 'info' | 'warning' | 'maintenance' | 'incident';

export interface AdminMessage {
  id: string;
  categoryId: string;
  content: string;
  timestamp: string;
  author: string;
  type: MessageType;
  pinned?: boolean;
}

export interface StatusOverride {
  status: 'operational' | 'degraded' | 'down';
  timestamp: string;
  author: string;
}

export interface MessagesCache {
  messages: AdminMessage[];
  statusOverrides?: Record<string, StatusOverride>;
}

// API response types
export interface StatusApiResponse extends StatusCache {
  meta: {
    fromCache: boolean;
    lastUpdate: string;
  };
}

// Prometheus query result
export interface PrometheusQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
}

// Prometheus range query result
export interface PrometheusRangeQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
}
