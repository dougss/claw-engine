import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-20">
      <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-border-3 flex items-center justify-center text-text-dim">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-text-secondary">{title}</p>
        {description && (
          <p className="text-xs text-text-muted mt-1 max-w-xs">{description}</p>
        )}
      </div>
    </div>
  );
}
