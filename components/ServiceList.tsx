'use client';

import { Category, Service, ServiceStatusData, StatusOverride } from '@/lib/types';
import CategoryCard from './CategoryCard';

interface ServiceListProps {
  categories: Category[];
  services: Service[];
  statusData: ServiceStatusData[];
  statusOverrides: Record<string, StatusOverride>;
}

export default function ServiceList({
  categories,
  services,
  statusData,
  statusOverrides,
}: ServiceListProps) {
  return (
    <div className="space-y-4">
      {categories.map((category) => {
        const categoryServices = services.filter(
          (service) => service.categoryId === category.id
        );

        return (
          <CategoryCard
            key={category.id}
            category={category}
            services={categoryServices}
            statusData={statusData}
            statusOverride={statusOverrides[category.id]}
          />
        );
      })}
    </div>
  );
}
