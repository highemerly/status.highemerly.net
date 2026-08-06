import { AdminMessage as AdminMessageType, Category } from '@/lib/types';

interface AdminMessageProps {
  message: AdminMessageType;
  categories: Category[];
}

const messageTypeConfig = {
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    icon: 'ℹ️',
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: '⚠️',
  },
  maintenance: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    icon: '🔧',
  },
  incident: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    icon: '🚨',
  },
};

export default function AdminMessage({ message, categories }: AdminMessageProps) {
  const config = messageTypeConfig[message.type];
  const timestamp = new Date(message.timestamp).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Find category name from categoryId
  const category = categories.find(cat => cat.id === message.categoryId);
  const categoryName = category ? category.name : message.categoryId;

  return (
    <div
      className={`rounded-lg border p-2.5 sm:p-3 ${config.bg} ${config.border} ${
        message.pinned ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg sm:text-xl flex-shrink-0">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-0.5">
            <span className="font-semibold text-sm sm:text-base text-gray-900 dark:text-gray-100">
              {categoryName}
            </span>
            {message.pinned && (
              <span className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full">
                📌
              </span>
            )}
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              {timestamp}
            </span>
          </div>
          <p className="text-sm sm:text-base text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
