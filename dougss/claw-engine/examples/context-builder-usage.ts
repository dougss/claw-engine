import { ContextBuilder } from '../src';

async function example() {
  // Initialize the context builder with a workspace path
  const contextBuilder = new ContextBuilder({
    workspacePath: '/path/to/project'
  });
  
  // Build a system prompt with auto-loaded context files
  const systemPrompt = await contextBuilder.buildSystemPrompt(
    'You are an AI assistant helping with this project.'
  );
  
  console.log('Final system prompt:');
  console.log(systemPrompt);
}

// Only run if this file is executed directly
if (require.main === module) {
  example().catch(console.error);
}