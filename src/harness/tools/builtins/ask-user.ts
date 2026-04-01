import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const askUserTool: ToolHandler = {
  name: "ask_user",
  description: "Ask the user a question",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
    },
    required: ["question"],
  },
  async execute(input, context) {
    if (!isRecord(input) || typeof input.question !== "string") {
      return {
        output: "invalid input: expected { question: string }",
        isError: true,
      };
    }

    if (context.onAskUser) {
      try {
        const answer = await context.onAskUser(input.question);
        return { output: answer, isError: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: message, isError: true };
      }
    }

    return {
      output: JSON.stringify({
        status: "pending",
        token: "pending_user_input",
        question: input.question,
      }),
      isError: false,
    };
  },
};
