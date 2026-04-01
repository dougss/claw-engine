import type { ModelAdapter } from "../harness/model-adapters/adapter-types.js";
import { workItemDAGSchema, type WorkItemDAG } from "./dag-schema.js";

export interface DecomposeInput {
  featureDescription: string;
  repoContext: string;
  repo: string;
  adapter: ModelAdapter;
}

export async function decomposeFeature({
  featureDescription,
  repoContext,
  repo,
  adapter,
}: DecomposeInput): Promise<WorkItemDAG> {
  const systemPrompt = `You are a technical decomposer. Given a feature request, output a valid JSON WorkItemDAG with tasks array and edges array. Each task needs: id (string), repo, branch (format: claw/<task-id>), description, complexity (simple|medium|complex), estimated_tokens (integer).`;

  const userPrompt = `Decompose this feature for repo "${repo}":\n${featureDescription}\n\nRepo context:\n${repoContext}\n\nOutput ONLY valid JSON matching the WorkItemDAG schema.`;

  let jsonText = "";
  for await (const event of adapter.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    [],
  )) {
    if (event.type === "text_delta") jsonText += event.text;
  }

  // Extract JSON from markdown code blocks if present
  const jsonMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(jsonText);
  const rawJson = jsonMatch ? jsonMatch[1] : jsonText.trim();

  const parsed = JSON.parse(rawJson) as unknown;
  return workItemDAGSchema.parse(parsed);
}
