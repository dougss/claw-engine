/**
 * Nexus client: queries Nexus MCP for skills relevant to a task.
 * In production, this calls the Nexus MCP server via stdio.
 * For now, implements the interface with a stub that can be activated.
 */
export interface NexusSkill {
  name: string;
  content: string;
  relevance: number;
}

export async function queryNexusSkills({
  taskDescription: _taskDescription,
  skillNames,
  nexusBaseUrl = "http://localhost:3002",
}: {
  taskDescription: string;
  skillNames: string[];
  nexusBaseUrl?: string;
}): Promise<NexusSkill[]> {
  // Query Nexus REST API for skill content
  const skills: NexusSkill[] = [];

  for (const name of skillNames) {
    try {
      const response = await fetch(
        `${nexusBaseUrl}/api/skills/${encodeURIComponent(name)}`,
      );
      if (!response.ok) continue;
      const data = (await response.json()) as { name: string; content: string };
      skills.push({ name: data.name, content: data.content, relevance: 1.0 });
    } catch {
      // Nexus unavailable — continue without skill
    }
  }

  return skills;
}
