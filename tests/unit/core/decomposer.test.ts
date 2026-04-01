import { describe, it, expect } from "vitest";
import { decomposeFeature } from "../../../src/core/decomposer.js";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";

describe("decomposeFeature", () => {
  it("returns a parsed WorkItemDAG from model output", async () => {
    const dag = JSON.stringify({
      title: "Add login endpoint",
      tasks: [
        {
          id: "t1",
          repo: "my/repo",
          branch: "claw/t1",
          description: "create model",
          complexity: "simple",
          estimated_tokens: 1000,
        },
      ],
      edges: [],
    });

    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: dag }]],
    });

    const result = await decomposeFeature({
      featureDescription: "Add login endpoint",
      repoContext: "Next.js app",
      repo: "my/repo",
      adapter,
    });

    expect(result.title).toBe("Add login endpoint");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].complexity).toBe("simple");
  });

  it("extracts JSON from markdown code blocks", async () => {
    const dag = JSON.stringify({
      title: "Fix bug",
      tasks: [
        {
          id: "t1",
          repo: "r",
          branch: "claw/t1",
          description: "fix",
          complexity: "simple",
          estimated_tokens: 500,
        },
      ],
      edges: [],
    });

    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: "```json\n" + dag + "\n```" }]],
    });

    const result = await decomposeFeature({
      featureDescription: "Fix bug",
      repoContext: "",
      repo: "r",
      adapter,
    });
    expect(result.tasks[0].id).toBe("t1");
  });

  it("throws when model returns invalid JSON", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: "not json at all" }]],
    });

    await expect(
      decomposeFeature({
        featureDescription: "x",
        repoContext: "",
        repo: "r",
        adapter,
      }),
    ).rejects.toThrow();
  });
});
