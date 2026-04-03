import { useState, useEffect } from "react";
import type { TaskFull } from "../lib/api";
import { useSseSubscription } from "../lib/sse-context";

export function useTasks() {
  const [tasks, setTasks] = useState<TaskFull[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/v1/tasks?limit=50");
      if (response.ok) {
        const data = await response.json();
        // Assuming the API returns an object with a 'tasks' property
        const fetchedTasks: TaskFull[] = data.tasks || data.items || data;

        // Sort tasks: running first by startedAt desc, then completed/failed by completedAt desc
        const sortedTasks = [...fetchedTasks].sort((a, b) => {
          const aRunning = a.status === "running";
          const bRunning = b.status === "running";

          if (aRunning && !bRunning) return -1;
          if (!aRunning && bRunning) return 1;

          // Both running or both not running - sort by time
          if (aRunning) {
            // Both running - sort by startedAt desc (assuming createdAt represents startedAt)
            return (
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          } else {
            // Both completed/failed - sort by completedAt desc (durationMs would indicate completion)
            const bTime = b.durationMs
              ? new Date(b.createdAt).getTime() + b.durationMs
              : new Date(b.createdAt).getTime();
            const aTime = a.durationMs
              ? new Date(a.createdAt).getTime() + a.durationMs
              : new Date(a.createdAt).getTime();
            return bTime - aTime;
          }
        });

        setTasks(sortedTasks);

        // Auto-select first running task or most recent if none running
        if (!selectedId) {
          const runningTask = sortedTasks.find(
            (task) => task.status === "running",
          );
          const firstTask = runningTask || sortedTasks[0];
          if (firstTask) {
            setSelectedId(firstTask.id);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  // Subscribe to SSE events for session_start and session_end
  useSseSubscription((event) => {
    if (event.type === "session_start" || event.type === "session_end") {
      // Refetch tasks when session events happen
      fetchTasks();
    }
  });

  // Initial fetch
  useEffect(() => {
    fetchTasks();
  }, []);

  const selectedTask = tasks.find((task) => task.id === selectedId) || null;

  return {
    tasks,
    selectedId,
    setSelectedId,
    selectedTask,
    loading,
  };
}
