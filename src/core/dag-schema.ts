import { z } from "zod";

const retryPolicySchema = z.object({
  max_attempts: z.number().int().default(3),
  backoff: z
    .union([z.literal("linear"), z.literal("exponential")])
    .default("linear"),
  escalate_model_on_retry: z.boolean().default(true),
  on_failure: z
    .union([
      z.literal("block_dependents"),
      z.literal("skip_and_continue"),
      z.literal("cancel_work_item"),
    ])
    .default("block_dependents"),
});

export const taskNodeSchema = z.object({
  id: z.string(),
  repo: z.string(),
  branch: z.string(),
  description: z.string(),
  complexity: z.union([
    z.literal("simple"),
    z.literal("medium"),
    z.literal("complex"),
  ]),
  context_filter: z.array(z.string()).default([]),
  nexus_skills: z.array(z.string()).default([]),
  mcp_servers: z.array(z.string()).default([]),
  estimated_tokens: z.number().int().nonnegative(),
  retry_policy: retryPolicySchema.optional(),
});

export const dependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.union([z.literal("blocks"), z.literal("informs")]),
});

export const workItemDAGSchema = z.object({
  title: z.string(),
  tasks: z.array(taskNodeSchema).min(1),
  edges: z.array(dependencyEdgeSchema).default([]),
});

export type TaskNode = z.infer<typeof taskNodeSchema>;
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;
export type WorkItemDAG = z.infer<typeof workItemDAGSchema>;
