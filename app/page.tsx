'use client';

import { useEffect, useState } from 'react';
import { ServiceStatusData, AdminMessage, Category, Service, StatusOverride } from '@/lib/types';
import ServiceList from '@/components/ServiceList';
import AdminMessageComponent from '@/components/AdminMessage';

export default function HomePage() {
  const [statusData, setStatusData] = useState<ServiceStatusData[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusOverride>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    // 初回ロード
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      await Promise.all([
        loadConfig(),
        loadStatusData(),
        loadMessages()
      ]);
    } catch (error) {
      console.error('Failed to load all data:', error);
    }
  }

  /**
   * config/services.json を読み込み
   */
  async function loadConfig() {
    try {
      const response = await fetch('/config/services.json');
      const config = await response.json();
      setCategories(config.categories || []);
      setServices(config.services || []);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  /**
   * /data/status.json を読み込み
   * lastUpdateが5分以上古い場合は更新をリクエスト
   */
  async function loadStatusData() {
    try {
      // 1. S3から status.json を取得（CloudFront経由、キャッシュ有効）
      const response = await fetch('/data/status.json');
      const data = await response.json();

      console.log('Loaded status.json:', data);

      // 2. まず古いデータでも一度描画する
      setStatusData(data.services || []);
      setLastUpdate(data.lastUpdate);

      // 3. lastUpdate をチェック（5分 = 300秒）
      const lastUpdateTime = new Date(data.lastUpdate);
      const now = new Date();
      const ageInSeconds = (now.getTime() - lastUpdateTime.getTime()) / 1000;

      console.log(`Status age: ${ageInSeconds}s`);

      if (ageInSeconds >= 300) {
        // 5分以上古い → 更新をリクエスト
        console.log('Status is stale, requesting update...');
        setUpdating(true); // ローディング表示開始

        try {
          const updateResponse = await fetch('/api/v1/status');

          const updateResult = await updateResponse.json();
          console.log('Update result:', updateResult);

          // APIレスポンスから最新データを取得して再描画
          // レスポンスは {lastUpdate, services} の形式
          setStatusData(updateResult.services || []);
          setLastUpdate(updateResult.lastUpdate);
        } catch (error) {
          console.error('Status update failed:', error);
          // エラーでも古いデータを表示（既に描画済み）
        } finally {
          setUpdating(false); // ローディング表示終了
        }
      }
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  }

  /**
   * /data/messages.json を読み込み
   */
  async function loadMessages() {
    try {
      const response = await fetch('/data/messages.json');
      const data = await response.json();
      setMessages(data.messages || []);
      setStatusOverrides(data.statusOverrides || {});
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  // Overall status 計算（statusOverrideも考慮）
  const effectiveStatuses = statusData.map((s) => {
    // カテゴリ単位のoverride
    const serviceObj = services.find((svc) => svc.id === s.id);
    if (serviceObj) {
      const override = statusOverrides[serviceObj.categoryId];
      if (override) {
        return override.status === 'operational' ? 'up' : override.status === 'degraded' ? 'degraded' : 'down';
      }
    }
    return s.status;
  });

  const hasDownService = effectiveStatuses.some((s) => s === 'down');
  const hasDegradedService = effectiveStatuses.some((s) => s === 'degraded');

  let overallStatus = 'All Systems Operational';
  let overallStatusColor = 'text-status-up';

  if (hasDownService) {
    overallStatus = 'Service Disruption';
    overallStatusColor = 'text-status-down';
  } else if (hasDegradedService) {
    overallStatus = 'Partial Service Disruption';
    overallStatusColor = 'text-status-degraded';
  }

  // 更新中の場合は表示を追加
  if (updating) {
    overallStatus = overallStatus + ' (更新中...)';
  }

  const lastUpdateTime = lastUpdate
    ? new Date(lastUpdate).toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '-';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Status Page
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            はん(highemerly)が提供するサービスの運用状況
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            最終更新: {lastUpdateTime} (JST)
          </p>
          <br></br>
          <p className={`text-xl font-semibold ${overallStatusColor} ${updating ? 'animate-pulse' : ''}`}>
            {overallStatus}
          </p>
        </header>

        {/* Status Legend */}
        <div className="flex items-center justify-center gap-5 mb-4 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-status-up rounded"></span>
            <span>Up</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-status-degraded rounded"></span>
            <span>Degraded</span>
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

        {/* Admin Messages */}
        {messages.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
              アナウンス
            </h2>
            <div className="space-y-2.5">
              {messages.slice(0, 5).map((message) => (
                <AdminMessageComponent
                  key={message.id}
                  message={message}
                  categories={categories}
                />
              ))}
            </div>
          </section>
        )}

        {/* Service Status List */}
        <section>
          <ServiceList
            categories={categories}
            services={services}
            statusData={statusData}
            statusOverrides={statusOverrides}
          />
        </section>
        {/* Footer */}
        <footer className="mt-12 text-center text-xs text-gray-400 dark:text-gray-600">
          <a
            href="https://highemerly.net/contact.html"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
          >
            Contact
          </a>
        </footer>
      </div>
    </main>
  );
}
