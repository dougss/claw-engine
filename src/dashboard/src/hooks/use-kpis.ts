import { useMemo } from "react";
import type { Task } from "../lib/api";

interface KpiData {
  running: number;
  completedToday: number;
  failedToday: number;
  tokensToday: number;
  costToday: number;
}

const isSameDay = (dateStr: string | null, today: Date): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
};

export const formatTokens = (n: number): string => {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
};

export const formatCost = (n: number): string => `$${n.toFixed(2)}`;

export const useKpis = (
  tasks: Task[],
): {
  kpis: KpiData;
  formatTokens: (n: number) => string;
  formatCost: (n: number) => string;
} => {
  const kpis = useMemo(() => {
    const kpiData: KpiData = {
      running: 0,
      completedToday: 0,
      failedToday: 0,
      tokensToday: 0,
      costToday: 0,
    };

    const today = new Date();

    for (const task of tasks) {
      if (task.status === "running") {
        kpiData.running++;
      }

      const occurredToday =
        isSameDay(task.startedAt, today) || isSameDay(task.completedAt, today);

      if (occurredToday) {
        if (task.status === "completed") kpiData.completedToday++;
        else if (task.status === "failed") kpiData.failedToday++;

        if (task.tokensUsed) kpiData.tokensToday += task.tokensUsed;
        if (task.costUsd) kpiData.costToday += parseFloat(task.costUsd);
      }
    }

    return kpiData;
  }, [tasks]);

  return { kpis, formatTokens, formatCost };
};
