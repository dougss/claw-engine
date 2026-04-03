import { Header } from './components/header';
import { TaskList } from './components/task-list';
import { StreamPane } from './components/stream-pane';
import { useTasks } from './hooks/use-tasks';
import { useKpis } from './hooks/use-kpis';
import { useStream } from './hooks/use-stream';
import { useSseContext } from './lib/sse-context';
import { type TaskFull } from './lib/api';

export function App() {
  const { tasks, selectedId, setSelectedId } = useTasks();
  const selectedTask = tasks.find(task => task.id === selectedId) || null;
  // Type assertion to align types between API and KPIs hook
  const typedTasks = tasks as Array<{
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    tokensUsed?: number;
    cost?: number;
  }>;
  const { kpis } = useKpis(typedTasks);
  const { events, isLive } = useStream(selectedId, selectedTask?.status || '');
  const { connected } = useSseContext(); // Get SSE connection state

  return (
    <div className="h-screen flex flex-col bg-bg text-text-primary overflow-hidden">
      <Header kpis={kpis} connected={connected} />
      <div className="flex-1 flex overflow-hidden">
        <TaskList 
          tasks={tasks} 
          selectedId={selectedId} 
          onSelect={setSelectedId} 
        />
        <StreamPane 
          task={selectedTask as TaskFull | null} 
          events={events} 
          isLive={isLive} 
        />
      </div>
    </div>
  );
}
