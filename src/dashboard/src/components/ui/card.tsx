import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  interactive?: boolean;
}

export function Card({
  children,
  className = "",
  glow = false,
  interactive = false,
}: CardProps) {
  return (
    <div
      className={[
        "bg-surface rounded-xl border border-border-2 inset-border",
        glow
          ? "shadow-[0_0_0_1px_rgba(0,212,255,0.06),0_4px_24px_rgba(0,0,0,0.4)]"
          : "",
        interactive
          ? "cursor-pointer hover:border-border-4 hover:bg-surface-2 transition-colors duration-200"
          : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  accentClass?: string;
  trend?: { value: string; positive?: boolean };
  loading?: boolean;
}

export function StatCard({
  label,
  value,
  icon,
  accentClass = "text-accent",
  trend,
  loading,
}: StatCardProps) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted tracking-wide uppercase">
          {label}
        </span>
        <span
          className={`p-2 rounded-lg bg-surface-2 border border-border-3 ${accentClass}`}
        >
          {icon}
        </span>
      </div>
      {loading ? (
        <div className="h-8 w-24 shimmer rounded-md" />
      ) : (
        <div className="animate-counter">
          <div
            className={`font-heading text-2xl font-semibold tracking-tight ${accentClass}`}
          >
            {value}
          </div>
          {trend && (
            <p
              className={`text-xs mt-1 font-mono ${trend.positive ? "text-status-completed" : "text-status-failed"}`}
            >
              {trend.value}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
