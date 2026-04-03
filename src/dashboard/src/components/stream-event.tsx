import React from 'react';

export type StreamEvent = {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
};

interface StreamEventProps {
  event: StreamEvent;
  now: number;
}

const StreamEventComponent: React.FC<StreamEventProps> = ({ event, now }) => {
  const { type, timestamp, data } = event;

  // Calculate relative time
  const timeDiff = now - timestamp;
  let timeLabel = '';
  if (timeDiff < 60000) {
    timeLabel = `${Math.max(0, Math.floor(timeDiff / 1000))}s`;
  } else if (timeDiff < 3600000) {
    timeLabel = `${Math.floor(timeDiff / 60000)}m`;
  } else {
    timeLabel = `${Math.floor(timeDiff / 3600000)}h`;
  }

  // Handle different event types
  switch (type) {
    case 'heartbeat':
      return null;

    case 'tool_use': {
      const name = data.name as string || '';
      const input = data.input;
      let inputPreview = '';
      if (typeof input === 'string') {
        inputPreview = input.substring(0, 80);
      } else if (input && typeof input === 'object') {
        inputPreview = JSON.stringify(input).substring(0, 80);
      }
      
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="flex items-center gap-2">
            <span className="text-stream-tool font-mono text-xs px-2 py-0.5 rounded bg-stream-tool/10">[tool]</span>
            <span className="font-mono text-sm">{`${name}${inputPreview ? `(${inputPreview})` : ''}`}</span>
          </div>
        </div>
      );
    }

    case 'text_delta': {
      const text = data.text as string || '';
      if (!text) return null;
      
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="text-sm text-stream-text">{text}</div>
        </div>
      );
    }

    case 'token_update': {
      const percent = data.percent as number | undefined;
      if (typeof percent !== 'number') return null;
      
      // Only render if percent changed by >=5
      const prevPercent = data.prev_percent as number | undefined;
      if (prevPercent !== undefined && Math.abs(percent - prevPercent) < 5) {
        return null;
      }
      
      const usedTokens = data.used_tokens as number || 0;
      const totalTokens = data.total_tokens as number || 0;
      const formattedUsed = formatTokens(usedTokens);
      const formattedTotal = formatTokens(totalTokens);
      
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="text-stream-token font-mono text-sm">tokens {percent.toFixed(0)}% ({formattedUsed} / {formattedTotal})</div>
        </div>
      );
    }

    case 'session_end': {
      const status = data.status as string || '';
      const reason = data.reason as string || '';
      let bgColor = 'bg-status-completed/10';
      
      if (status === 'failed') {
        bgColor = 'bg-status-failed/10';
      } else if (status === 'interrupted' || status === 'cancelled') {
        bgColor = 'bg-status-running/10';
      }
      
      return (
        <div className={`flex items-start gap-3 px-4 py-1 ${bgColor}`}>
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0"></span>
          <div className="w-full text-center py-2 text-sm">
            Session {status}: {reason}
          </div>
        </div>
      );
    }

    case 'routing_decision': {
      const provider = data.provider as string || '';
      const reason = data.reason as string || '';
      
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="text-text-tertiary text-xs">
            routed → {provider} {reason ? `(${reason})` : ''}
          </div>
        </div>
      );
    }

    case 'phase_start': {
      const phase = data.phase as string || '';
      
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="text-accent text-sm">
            ▶ {phase} started
          </div>
        </div>
      );
    }

    case 'phase_end': {
      const phase = data.phase as string || '';
      const status = data.status as string || '';
      const duration = data.duration as number | undefined;
      const statusSymbol = status === 'completed' ? '✓' : '✗';
      const statusText = status === 'completed' 
        ? duration !== undefined ? `completed (${(duration / 1000).toFixed(1)}s)` : 'completed'
        : 'failed';
      
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="text-accent text-sm">
            {statusSymbol} {phase} {statusText}
          </div>
        </div>
      );
    }

    default:
      // Default case - show basic representation of the event
      return (
        <div className="flex items-start gap-3 px-4 py-1">
          <span className="text-xs font-mono text-text-tertiary w-12 shrink-0">{timeLabel}</span>
          <div className="text-sm text-text-secondary">
            [{type}] {JSON.stringify(data)}
          </div>
        </div>
      );
  }
};

// Helper function to format tokens
const formatTokens = (num: number): string => {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
};

export default StreamEventComponent;