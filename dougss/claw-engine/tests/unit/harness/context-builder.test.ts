import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ContextBuilder } from '../../../src/harness/context-builder';

// Mock the fs module
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn()
  }
}));

describe('ContextBuilder', () => {
  const mockFs = vi.mocked(fs);
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prepend context files to the base prompt', async () => {
    const workspacePath = '/test/workspace';
    const basePrompt = 'Base system prompt';
    
    // Mock file reads
    mockFs.readFile.mockImplementation(async (filePath: any) => {
      if (filePath === path.join(workspacePath, 'CLAUDE.md')) {
        return '# Claude Instructions\nThese are Claude instructions.';
      }
      if (filePath === path.join(workspacePath, 'AGENTS.md')) {
        return '# Agent Guidelines\nThese are agent guidelines.';
      }
      throw new Error('File not found');
    });
    
    // Mock directory access
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    
    const contextBuilder = new ContextBuilder({ workspacePath });
    const result = await contextBuilder.buildSystemPrompt(basePrompt);
    
    expect(result).toContain('# Claude Instructions');
    expect(result).toContain('# Agent Guidelines');
    expect(result).toContain('Base system prompt');
  });

  it('should handle missing files silently', async () => {
    const workspacePath = '/test/workspace';
    const basePrompt = 'Base system prompt';
    
    // Mock to throw errors for all files (simulating missing files)
    mockFs.readFile.mockRejectedValue(new Error('File not found'));
    mockFs.access.mockRejectedValue(new Error('Directory not found'));
    
    const contextBuilder = new ContextBuilder({ workspacePath });
    const result = await contextBuilder.buildSystemPrompt(basePrompt);
    
    expect(result).toBe(basePrompt); // Should just return the base prompt
  });

  it('should include cursor rules files', async () => {
    const workspacePath = '/test/workspace';
    const basePrompt = 'Base system prompt';
    
    // Mock file reads
    mockFs.readFile.mockImplementation(async (filePath: any) => {
      if (filePath === path.join(workspacePath, 'CLAUDE.md')) {
        return '# Claude Instructions\nThese are Claude instructions.';
      }
      if (filePath === path.join(workspacePath, '.cursor', 'rules', 'style.md')) {
        return 'Use consistent styling.';
      }
      if (filePath === path.join(workspacePath, '.cursor', 'rules', 'formatting.md')) {
        return 'Format consistently.';
      }
      throw new Error('File not found');
    });
    
    // Mock directory access and contents
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue(['style.md', 'formatting.md']);
    
    const contextBuilder = new ContextBuilder({ workspacePath });
    const result = await contextBuilder.buildSystemPrompt(basePrompt);
    
    expect(result).toContain('# Claude Instructions');
    expect(result).toContain('Use consistent styling.');
    expect(result).toContain('Format consistently.');
    expect(result).toContain('Base system prompt');
  });

  it('should truncate content if it exceeds 10KB limit', async () => {
    const workspacePath = '/test/workspace';
    const basePrompt = 'Base system prompt';
    
    // Create a large content (> 10KB)
    const largeContent = 'A'.repeat(11 * 1024); // 11KB
    
    mockFs.readFile.mockResolvedValue(largeContent);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    
    const contextBuilder = new ContextBuilder({ workspacePath });
    const result = await contextBuilder.buildSystemPrompt(basePrompt);
    
    // Should be truncated to fit within 10KB including the file name header
    const expectedMaxSize = 10 * 1024 + basePrompt.length + 20; // Add some buffer for the filename header
    expect(result.length).toBeLessThanOrEqual(expectedMaxSize);
    expect(result).toContain('... truncated');
  });
});