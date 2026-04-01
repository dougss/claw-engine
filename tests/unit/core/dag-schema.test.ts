import { describe, it, expect } from "vitest";
import {
  taskNodeSchema,
  workItemDAGSchema,
  dependencyEdgeSchema,
} from "../../../src/core/dag-schema.js";

describe("dag-schema", () => {
  it("validates a valid task node", () => {
    const node = taskNodeSchema.parse({
      id: "task-1",
      repo: "dougss/finno",
      branch: "claw/task-1",
      description: "Add auth endpoint",
      complexity: "simple",
      estimated_tokens: 5000,
    });
    expect(node.context_filter).toEqual([]);
    expect(node.retry_policy).toBeUndefined();
  });

  it("rejects invalid complexity value", () => {
    expect(() =>
      taskNodeSchema.parse({
        id: "t1",
        repo: "r",
        branch: "b",
        description: "d",
        complexity: "ultra-hard",
        estimated_tokens: 100,
      }),
    ).toThrow();
  });

  it("validates a full DAG", () => {
    const dag = workItemDAGSchema.parse({
      title: "Add user auth",
      tasks: [
        {
          id: "t1",
          repo: "r",
          branch: "b1",
          description: "create model",
          complexity: "simple",
          estimated_tokens: 1000,
        },
        {
          id: "t2",
          repo: "r",
          branch: "b2",
          description: "create API",
          complexity: "medium",
          estimated_tokens: 3000,
        },
      ],
      edges: [{ from: "t1", to: "t2", type: "blocks" }],
    });
    expect(dag.tasks).toHaveLength(2);
    expect(dag.edges[0].type).toBe("blocks");
  });

  it("rejects DAG with no tasks", () => {
    expect(() =>
      workItemDAGSchema.parse({ title: "empty", tasks: [], edges: [] }),
    ).toThrow();
  });
});
