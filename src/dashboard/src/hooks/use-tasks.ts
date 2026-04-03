import { useState, useEffect, useRef } from "react";
import type { TaskFull } from "../lib/api";
import { useSseSubscription } from "../lib/sse-context";

export function useTasks() {
  const [tasks, setTasks] = useState<TaskFull[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/v1/tasks?limit=50");
      if (!response.ok) return;
      const data = await response.json();
      const fetchedTasks: TaskFull[] = data.tasks || data.items || data;

      const sortedTasks = [...fetchedTasks].sort((a, b) => {
        const aRunning = a.status === "running";
        const bRunning = b.status === "running";
        if (aRunning && !bRunning) return -1;
        if (!aRunning && bRunning) return 1;
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

      setTasks(sortedTasks);

      if (!selectedIdRef.current) {
        const running = sortedTasks.find((t) => t.status === "running");
        const first = running || sortedTasks[0];
        if (first) setSelectedId(first.id);
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  // Refetch task list on ANY SSE event (CLI publishes all events to Redis)
  const lastRefetchRef = useRef(0);
  useSseSubscription(() => {
    // Throttle: max 1 refetch per 3 seconds
    const now = Date.now();
    if (now - lastRefetchRef.current > 3000) {
      lastRefetchRef.current = now;
      fetchTasks();
    }
  });

  // Initial fetch only — no polling
  useEffect(() => {
    fetchTasks();
  }, []);

  const selectedTask = tasks.find((t) => t.id === selectedId) || null;

  return { tasks, selectedId, setSelectedId, selectedTask, loading };
}
