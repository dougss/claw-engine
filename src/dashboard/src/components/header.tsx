import React from 'react';
import { ConnectionIndicator } from './connection-indicator';

interface HeaderProps {
  kpis: {
    running: number;
    completedToday: number;
    failedToday: number;
    tokensToday: number;
    costToday: number;
  };
  connected: boolean;
}

export const Header: React.FC<HeaderProps> = ({ kpis, connected }) => {
  // Use the format functions from the imported hook, but call them directly
  // as static utility functions rather than using the hook in the component
  
  return (
    <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4">
      {/* Left side: Logo */}
      <div className="flex items-center gap-2">
        {/* Bolt Icon - Inline SVG */}
        <svg 
          className="w-5 h-5 text-accent" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        <span className="text-text-primary font-semibold text-sm">Claw Engine</span>
        <span className="text-text-tertiary text-xs bg-surface-2 px-1.5 py-0.5 rounded ml-2">v2</span>
      </div>
      
      {/* Right side: KPI chips and Connection Indicator */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          {/* Running chip */}
          <div className="flex items-center gap-1">
            <span className={`text-xs ${kpis.running > 0 ? 'text-status-running' : 'text-text-tertiary'}`}>
              ● {kpis.running} running
            </span>
          </div>
          
          {/* Today stats chip */}
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary text-xs">today</span>
            <span className="text-text-primary font-mono text-sm">{kpis.completedToday}✓ {kpis.failedToday}✗</span>
          </div>
          
          {/* Tokens chip */}
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary text-xs">tokens</span>
            <span className="text-text-primary font-mono text-sm">
              {kpis.tokensToday >= 1000000 
                ? (kpis.tokensToday / 1000000).toFixed(1) + 'M' 
                : kpis.tokensToday >= 1000 
                  ? (kpis.tokensToday / 1000).toFixed(1) + 'K' 
                  : kpis.tokensToday.toString()}
            </span>
          </div>
          
          {/* Cost chip */}
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary text-xs">cost</span>
            <span className="text-text-primary font-mono text-sm">${kpis.costToday.toFixed(2)}</span>
          </div>
        </div>
        
        <ConnectionIndicator connected={connected} />
      </div>
    </header>
  );
};