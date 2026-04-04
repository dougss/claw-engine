import { useState, useEffect, useRef } from "react";
import type { TaskFull } from "../lib/api";
import { useSseSubscription } from "../lib/sse-context";

const PAGE_SIZE = 50;

function sortTasks(list: TaskFull[]): TaskFull[] {
  return [...list].sort((a, b) => {
    const aRunning = a.status === "running";
    const bRunning = b.status === "running";
    if (aRunning && !bRunning) return -1;
    if (!aRunning && bRunning) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function useTasks() {
  const [tasks, setTasks] = useState<TaskFull[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const fetchTasks = async (offset = 0, append = false) => {
    try {
      const response = await fetch(
        `/api/v1/tasks?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      if (!response.ok) return;
      const data = await response.json();
      const fetched: TaskFull[] = data.tasks || data.items || data;
      setTotal(data.total ?? fetched.length);

      if (append) {
        setTasks((prev) => {
          const ids = new Set(prev.map((t) => t.id));
          const merged = [...prev, ...fetched.filter((t) => !ids.has(t.id))];
          return sortTasks(merged);
        });
      } else {
        setTasks(sortTasks(fetched));
      }

      if (!selectedIdRef.current) {
        const running = fetched.find((t) => t.status === "running");
        const first = running || fetched[0];
        if (first) setSelectedId(first.id);
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = () => {
    if (loadingMore || tasks.length >= total) return;
    setLoadingMore(true);
    fetchTasks(tasks.length, true);
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
  const hasMore = tasks.length < total;

  return {
    tasks,
    selectedId,
    setSelectedId,
    selectedTask,
    loading,
    hasMore,
    loadMore,
    loadingMore,
    total,
  };
}
