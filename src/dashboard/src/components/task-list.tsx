import type { Task } from '../lib/api';
import { TaskItem } from './task-item';

interface TaskListProps {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TaskList({ tasks, selectedId, onSelect }: TaskListProps) {
  return (
    <div className="w-80 h-full overflow-y-auto border-r border-border bg-surface flex flex-col">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-primary">Tasks</h2>
          <span className="text-xs text-text-tertiary bg-surface-2 px-2 py-1 rounded">
            {tasks.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="p-4 text-center text-text-tertiary text-sm">
            No tasks yet
          </div>
        ) : (
          tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              onClick={() => onSelect(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}