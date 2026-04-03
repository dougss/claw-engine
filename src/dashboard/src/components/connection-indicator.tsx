import React from 'react';

interface ConnectionIndicatorProps {
  connected: boolean;
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({ connected }) => {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${
          connected ? 'bg-green-500 animate-status-pulse' : 'bg-red-500'
        }`}
      />
      <span className="text-text-secondary text-xs font-medium uppercase tracking-wide">
        {connected ? 'LIVE' : 'DISCONNECTED'}
      </span>
    </div>
  );
};