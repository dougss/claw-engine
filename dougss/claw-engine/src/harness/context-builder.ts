import { promises as fs } from 'fs';
import * as path from 'path';

interface ContextBuilderOptions {
  workspacePath: string;
}

export class ContextBuilder {
  private options: ContextBuilderOptions;

  constructor(options: ContextBuilderOptions) {
    this.options = options;
  }

  async buildSystemPrompt(basePrompt: string): Promise<string> {
    const { workspacePath } = this.options;
    
    // Files to look for in the workspace
    const contextFiles = [
      'CLAUDE.md',
      'AGENTS.md',
      '.claude/settings.json'
    ];
    
    // Find .cursor/rules/*.md files
    const cursorRulesDir = path.join(workspacePath, '.cursor', 'rules');
    let cursorRuleFiles: string[] = [];
    
    try {
      const ruleDirExists = await fs.access(cursorRulesDir).then(() => true).catch(() => false);
      if (ruleDirExists) {
        const ruleDirContents = await fs.readdir(cursorRulesDir);
        cursorRuleFiles = ruleDirContents
          .filter(file => file.endsWith('.md'))
          .map(file => path.join('.cursor', 'rules', file));
      }
    } catch (error) {
      // Silently ignore if .cursor/rules doesn't exist
    }

    // Combine all context files
    const allContextFiles = [...contextFiles, ...cursorRuleFiles];
    
    let contextContent = '';
    let totalSize = 0;
    const sizeLimit = 10 * 1024; // 10KB limit
    
    for (const fileName of allContextFiles) {
      try {
        const filePath = path.join(workspacePath, fileName);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        // Calculate the total length including header and footer
        const headerFooterLength = `--- ${fileName} ---\n`.length + 2; // +2 for \n\n
        
        // Check if adding this file would exceed the size limit
        if (totalSize + fileContent.length + headerFooterLength > sizeLimit) {
          const remainingSpace = sizeLimit - totalSize;
          if (remainingSpace > headerFooterLength) {
            // Account for header/footer length when truncating
            const availableSpace = remainingSpace - headerFooterLength;
            const truncatedContent = fileContent.substring(0, availableSpace - 13) + '... truncated';
            contextContent += `--- ${fileName} ---\n${truncatedContent}\n\n`;
            break; // Reached size limit
          } else {
            break; // No space left
          }
        }
        
        contextContent += `--- ${fileName} ---\n${fileContent}\n\n`;
        totalSize += fileContent.length + headerFooterLength;
      } catch (error) {
        // Silently ignore missing files
        continue;
      }
    }
    
    // Prepend context content to the base prompt
    return contextContent + basePrompt;
  }
}