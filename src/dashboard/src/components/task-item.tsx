import type { Task } from '../lib/api';

interface TaskItemProps {
  task: Task;
  selected: boolean;
  onClick: () => void;
}

export function TaskItem({ task, selected, onClick }: TaskItemProps) {
  // Determine status color based on task status
  const getStatusColor = () => {
    switch (task.status) {
      case 'running':
        return 'bg-status-running';
      case 'completed':
        return 'bg-status-completed';
      case 'failed':
        return 'bg-status-failed';
      default:
        return 'bg-status-pending';
    }
  };

  // Simple relative time calculation
  const getTimeAgo = () => {
    const createdAt = new Date(task.createdAt);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - createdAt.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return `${diffInSeconds}s ago`;
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    }
  };

  return (
    <div
      className={`flex items-center justify-between px-3 py-2.5 cursor-pointer ${
        selected 
          ? 'bg-surface-2 border-l-2 border-accent' 
          : 'hover:bg-surface-2/50'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full ${getStatusColor()} ${task.status === 'running' ? 'animate-pulse' : ''}`} />
        
        {/* Title and time */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary truncate">{task.description}</div>
          <div className="text-xs text-text-tertiary">{getTimeAgo()}</div>
        </div>
      </div>
      
      {/* Model badge */}
      {task.model && (
        <div className="text-xs font-mono text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded">
          {task.model}
        </div>
      )}
    </div>
  );
}