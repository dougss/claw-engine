import type { ToolHandler, ToolContext } from "../tool-types.js";
import { eq } from "drizzle-orm";
import { tasks } from "../../../storage/schema/index.js";
import {
  createTask as createTaskRepo,
  getTaskById as getTaskByIdRepo,
  getTasksByWorkItemId as getTasksByWorkItemIdRepo,
  updateTaskStatus as updateTaskStatusRepo,
  getTaskCheckpointData as getTaskCheckpointDataRepo,
  setTaskCheckpointData as setTaskCheckpointDataRepo,
} from "../../../storage/repositories/tasks-repo.js";
import { getDb } from "../../../storage/db.js";
import { randomUUID } from "node:crypto";

const CONNECTION_STRING =
  process.env.CLAW_ENGINE_DATABASE_URL ??
  "postgresql://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine";

function getDatabase() {
  return getDb({ connectionString: CONNECTION_STRING });
}

export const taskCreateTool: ToolHandler = {
  name: "task_create",
  description:
    "Create a new task. Input: { subject: string; description?: string; status?: string }",
  inputSchema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "The subject/title of the task" },
      description: {
        type: "string",
        description: "Detailed description of the task",
      },
      status: {
        type: "string",
        description: "Initial status of the task (default: pending)",
      },
    },
    required: ["subject"],
  },
  async execute(input, context: ToolContext) {
    if (!isRecord(input) || typeof input.subject !== "string") {
      return {
        output:
          "invalid input: expected { subject: string; description?: string; status?: string }",
        isError: true,
      };
    }

    if (!context.workItemId) {
      return {
        output: "task_create requires a workItemId in the tool context",
        isError: true,
      };
    }

    try {
      const subject = input.subject;
      const agentDescription =
        typeof input.description === "string" && input.description
          ? input.description
          : undefined;
      const status =
        typeof input.status === "string" ? input.status : undefined;

      const db = getDatabase();

      const task = await createTaskRepo(db, {
        workItemId: context.workItemId,
        repo: "session-tasks",
        branch: "main",
        description: subject,
        complexity: "medium",
        dagNodeId: randomUUID(),
        model: undefined,
      });

      if (agentDescription) {
        await setTaskCheckpointDataRepo(db, task.id, { agentDescription });
      }

      if (status && status !== "pending") {
        await updateTaskStatusRepo(db, task.id, status);
        task.status = status;
      }

      return {
        output: JSON.stringify({
          id: task.id,
          subject,
          status: task.status,
        }),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `Failed to create task: ${message}`, isError: true };
    }
  },
};

export const taskListTool: ToolHandler = {
  name: "task_list",
  isConcurrencySafe: true,
  description: "List tasks. Input: { status?: string }",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter tasks by status" },
    },
  },
  async execute(input, context: ToolContext) {
    if (!isRecord(input)) {
      return {
        output: "invalid input: expected { status?: string }",
        isError: true,
      };
    }

    if (!context.workItemId) {
      return {
        output: "task_list requires a workItemId in the tool context",
        isError: true,
      };
    }

    try {
      const db = getDatabase();
      const allTasks = await getTasksByWorkItemIdRepo(db, context.workItemId);

      const statusFilter =
        typeof input.status === "string" ? input.status : null;
      const filteredTasks = statusFilter
        ? allTasks.filter((task) => task.status === statusFilter)
        : allTasks;

      const result = filteredTasks.map((task) => {
        const checkpointData = task.checkpointData as Record<
          string,
          unknown
        > | null;
        return {
          id: task.id,
          subject: task.description,
          status: task.status,
          ...(checkpointData?.agentDescription
            ? { description: checkpointData.agentDescription }
            : {}),
        };
      });

      return {
        output: JSON.stringify(result),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `Failed to list tasks: ${message}`, isError: true };
    }
  },
};

export const taskUpdateTool: ToolHandler = {
  name: "task_update",
  description:
    "Update a task. Input: { id: string; status?: string; description?: string }",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The task ID to update" },
      status: { type: "string", description: "New status for the task" },
      description: {
        type: "string",
        description: "New description for the task",
      },
    },
    required: ["id"],
  },
  async execute(input, context: ToolContext) {
    if (!isRecord(input) || typeof input.id !== "string") {
      return {
        output:
          "invalid input: expected { id: string; status?: string; description?: string }",
        isError: true,
      };
    }

    if (!context.workItemId) {
      return {
        output: "task_update requires a workItemId in the tool context",
        isError: true,
      };
    }

    try {
      const db = getDatabase();

      const task = await getTaskByIdRepo(db, input.id);
      if (!task || task.workItemId !== context.workItemId) {
        return {
          output: `Task with ID ${input.id} not found or does not belong to this work item`,
          isError: true,
        };
      }

      const status = typeof input.status === "string" ? input.status : null;
      const description =
        typeof input.description === "string" ? input.description : null;

      if (status) {
        await updateTaskStatusRepo(db, input.id, status);
        task.status = status;
      }

      if (description) {
        const existing = (await getTaskCheckpointDataRepo(db, input.id)) ?? {};
        await setTaskCheckpointDataRepo(db, input.id, {
          ...existing,
          agentDescription: description,
        });
      }

      return {
        output: JSON.stringify({
          id: task.id,
          subject: task.description,
          status: task.status,
        }),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `Failed to update task: ${message}`, isError: true };
    }
  },
};

export const taskGetTool: ToolHandler = {
  name: "task_get",
  isConcurrencySafe: true,
  description: "Get a task by ID. Input: { id: string }",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The task ID to retrieve" },
    },
    required: ["id"],
  },
  async execute(input, context: ToolContext) {
    if (!isRecord(input) || typeof input.id !== "string") {
      return {
        output: "invalid input: expected { id: string }",
        isError: true,
      };
    }

    if (!context.workItemId) {
      return {
        output: "task_get requires a workItemId in the tool context",
        isError: true,
      };
    }

    try {
      const db = getDatabase();
      const task = await getTaskByIdRepo(db, input.id);

      if (!task || task.workItemId !== context.workItemId) {
        return {
          output: `Task with ID ${input.id} not found or does not belong to this work item`,
          isError: true,
        };
      }

      const checkpointData = task.checkpointData as Record<
        string,
        unknown
      > | null;

      return {
        output: JSON.stringify({
          id: task.id,
          subject: task.description,
          status: task.status,
          description: checkpointData?.agentDescription ?? null,
          repo: task.repo,
          branch: task.branch,
          complexity: task.complexity,
          createdAt: task.createdAt?.toISOString() || null,
          startedAt: task.startedAt?.toISOString() || null,
          completedAt: task.completedAt?.toISOString() || null,
        }),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `Failed to get task: ${message}`, isError: true };
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
