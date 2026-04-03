import { useMemo } from 'react';

// Define the Task type based on the expected structure
interface Task {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  tokensUsed?: number;
  cost?: number;
}

interface KpiData {
  running: number;
  completedToday: number;
  failedToday: number;
  tokensToday: number;
  costToday: number;
}

const isSameDay = (date1: Date | undefined, date2: Date = new Date()): boolean => {
  if (!date1) return false;
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  );
};

export const formatTokens = (n: number): string => {
  if (n >= 1000000) {
    return (n / 1000000).toFixed(1) + 'M';
  } else if (n >= 1000) {
    return (n / 1000).toFixed(1) + 'K';
  }
  return n.toString();
};

export const formatCost = (n: number): string => {
  return `$${n.toFixed(2)}`;
};

export const useKpis = (tasks: Task[]): { kpis: KpiData; formatTokens: (n: number) => string; formatCost: (n: number) => string } => {
  const kpis = useMemo(() => {
    const kpiData: KpiData = {
      running: 0,
      completedToday: 0,
      failedToday: 0,
      tokensToday: 0,
      costToday: 0,
    };

    const today = new Date();

    tasks.forEach(task => {
      // Count running tasks
      if (task.status === 'running') {
        kpiData.running++;
      }

      // Determine if task occurred today
      const startDate = task.startedAt ? new Date(task.startedAt) : undefined;
      const completionDate = task.completedAt ? new Date(task.completedAt) : undefined;
      
      const occurredToday = isSameDay(startDate, today) || isSameDay(completionDate, today);

      if (occurredToday) {
        // Count completed/failed today
        if (task.status === 'completed') {
          kpiData.completedToday++;
        } else if (task.status === 'failed') {
          kpiData.failedToday++;
        }

        // Sum tokens and costs for today
        if (task.tokensUsed) {
          kpiData.tokensToday += task.tokensUsed;
        }
        if (task.cost) {
          kpiData.costToday += task.cost;
        }
      }
    });

    return kpiData;
  }, [tasks]);

  return { kpis, formatTokens, formatCost };
};