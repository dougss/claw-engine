import { useState, useEffect, useRef } from 'react';
import { fetchTaskWithTelemetry, type TelemetryEntry } from '../lib/api';

export interface StreamEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface UseStreamResult {
  events: StreamEvent[];
  isLive: boolean;
}

export const useStream = (taskId: string | null, taskStatus: string): UseStreamResult => {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Clear events and close SSE connection when taskId changes
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setEvents([]);
    setIsLive(false);

    if (!taskId) {
      return;
    }

    if (taskStatus === 'running') {
      // Connect to SSE stream
      const url = `/api/v1/tasks/${taskId}/stream`;
      
      try {
        const es = new EventSource(url);
        eventSourceRef.current = es;
        setIsLive(true);

        es.onmessage = (event) => {
          try {
            const parsedData = JSON.parse(event.data);
            
            // Normalize the SSE event to StreamEvent shape
            const streamEvent: StreamEvent = {
              id: parsedData.id || Date.now().toString(),
              type: parsedData.type,
              timestamp: parsedData.timestamp || Date.now(),
              data: parsedData.data || {}
            };
            
            setEvents(prev => [...prev, streamEvent]);
          } catch (error) {
            console.error('Error parsing SSE event:', error);
          }
        };

        es.onerror = () => {
          setIsLive(false);
          es.close();
          eventSourceRef.current = null;
        };
      } catch (error) {
        console.error('Error connecting to SSE:', error);
        setIsLive(false);
      }
    } else if (taskStatus === 'completed' || taskStatus === 'failed') {
      // Fetch historical data
      const fetchData = async () => {
        try {
          const taskDetail = await fetchTaskWithTelemetry(taskId);
          
          if (taskDetail && taskDetail.telemetry) {
            // Convert telemetry array to StreamEvent format
            const historicalEvents: StreamEvent[] = taskDetail.telemetry.map((telemetryEntry: TelemetryEntry, index: number) => ({
              id: telemetryEntry.id || `historical-${index}`,
              type: telemetryEntry.eventType || 'unknown',
              timestamp: new Date(telemetryEntry.createdAt).getTime(),
              data: telemetryEntry.data as Record<string, unknown> || {}
            }));
            
            setEvents(historicalEvents);
          }
        } catch (error) {
          console.error('Error fetching historical data:', error);
        }
      };

      fetchData();
    }

    // Cleanup function
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [taskId, taskStatus]);

  return { events, isLive };
};