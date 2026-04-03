import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface PromptModalProps {
  prompt: string;
  onClose: () => void;
}

const PromptModal: React.FC<PromptModalProps> = ({ prompt, onClose }) => {
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  const handleBackdropClick = () => {
    onClose();
  };

  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div 
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-surface border border-border rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col mx-4"
        onClick={handleModalClick}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-text-primary font-medium">Task Prompt</div>
          <div 
            className="cursor-pointer text-text-tertiary hover:text-text-primary text-lg"
            onClick={onClose}
          >
            ×
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary">
            {prompt}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export { PromptModal };