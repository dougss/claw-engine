import type { ToolHandler, ToolContext } from "../tool-types.js";
import { eq, like, desc, sql } from "drizzle-orm";
import { workItems, tasks } from "../../../storage/schema/index.js";
import { 
  createTask as createTaskRepo, 
  getTaskById as getTaskByIdRepo, 
  getTasksByWorkItemId as getTasksByWorkItemIdRepo, 
  updateTaskStatus as updateTaskStatusRepo 
} from "../../../storage/repositories/tasks-repo.js";
import { createWorkItem } from "../../../storage/repositories/work-items-repo.js";
import { randomUUID } from "node:crypto";

// This will be replaced by the test environment
let getDatabaseConnectionOverride: (() => any) | null = null;

// Function to allow overriding the database connection (for testing)
export function __overrideGetDatabaseConnection(fn: () => any) {
  getDatabaseConnectionOverride = fn;
}

async function getDatabaseConnection() {
  if (getDatabaseConnectionOverride) {
    return getDatabaseConnectionOverride();
  }
  
  const { getDb } = await import("../../../storage/db.js");
  const connectionString = 
    process.env.CLAW_ENGINE_DATABASE_URL ??
    "postgresql://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine";
  
  return getDb({ connectionString });
}

// Helper function to get or create a work item for tasks
async function getOrCreateWorkItemForSession(sessionId: string) {
  const db = await getDatabaseConnection();
  
  // Look for an existing work item associated with this session
  // In a real implementation, we'd probably want to link the session to a work item
  // For now, we'll create a temporary work item if one doesn't exist
  const foundWorkItems = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(like(workItems.title, `%session:${sessionId}%`))
    .orderBy(desc(workItems.createdAt))
    .limit(1);
  
  if (foundWorkItems.length > 0) {
    return { id: foundWorkItems[0].id };
  }
  
  // Create a work item for this session
  const workItem = await createWorkItem(db, {
    title: `Tasks for session:${sessionId}`,
    description: `Tasks created during session ${sessionId}`,
    repos: ['unknown'], // Could be improved with actual repo info
    source: 'task_tool',
  });
  
  return workItem;
}

export const taskCreateTool: ToolHandler = {
  name: "task_create",
  description: "Create a new task. Input: { subject: string; description?: string; status?: string }",
  inputSchema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "The subject/title of the task" },
      description: { type: "string", description: "Detailed description of the task" },
      status: { type: "string", description: "Initial status of the task (default: pending)" },
    },
    required: ["subject"],
  },
  async execute(input, context: ToolContext) {
    if (!isRecord(input) || typeof input.subject !== "string") {
      return {
        output: "invalid input: expected { subject: string; description?: string; status?: string }",
        isError: true,
      };
    }

    try {
      // Extract values with proper type checking
      const subject = input.subject as string;
      const description = (typeof input.description === "string" && input.description) 
        ? input.description 
        : subject;
      const status = typeof input.status === "string" ? input.status : undefined;

      // Get or create a work item for this session
      const workItem = await getOrCreateWorkItemForSession(context.sessionId);
      
      // Generate a unique task ID
      const taskId = randomUUID();
      
      const db = await getDatabaseConnection();
      
      // Create the task record in the database
      // Store both subject and description in a structured format in the description field
      // so we can retrieve both when needed
      const taskData = {
        subject: subject,
        description: description || subject
      };
      const taskDescription = JSON.stringify(taskData);
      
      const task = await createTaskRepo(db, {
        workItemId: workItem.id,
        repo: "session-tasks", // Using a generic repo name for session tasks
        branch: "main", // Using main as default branch for session tasks
        description: taskDescription,
        complexity: "medium", // Default complexity
        dagNodeId: taskId, // Using task ID as DAG node ID
        model: undefined, // No specific model for these tasks
      });
      
      // Update the status if provided
      if (status && status !== "pending") {
        await updateTaskStatusRepo(db, task.id, status);
        task.status = status;
      }

      return {
        output: JSON.stringify({
          id: task.id,
          subject: subject,
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

    try {
      // Get the work item for this session
      const workItem = await getOrCreateWorkItemForSession(context.sessionId);
      
      const db = await getDatabaseConnection();
      
      // Get all tasks for this work item
      const tasks = await getTasksByWorkItemIdRepo(db, workItem.id);
      
      // Filter by status if provided
      let filteredTasks = tasks;
      const statusFilter = typeof input.status === "string" ? input.status : null;
      if (statusFilter) {
        filteredTasks = tasks.filter(task => task.status === statusFilter);
      }
      
      // Format the results
      const result = filteredTasks.map(task => {
        let subject = task.description;
        try {
          // Try to parse the description as JSON to extract subject
          const parsed = JSON.parse(task.description);
          if (parsed && typeof parsed === 'object' && 'subject' in parsed) {
            subject = parsed.subject;
          }
        } catch {
          // If parsing fails, fall back to the raw description
        }
        
        return {
          id: task.id,
          subject: subject,
          status: task.status,
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
  description: "Update a task. Input: { id: string; status?: string; description?: string }",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The task ID to update" },
      status: { type: "string", description: "New status for the task" },
      description: { type: "string", description: "New description for the task" },
    },
    required: ["id"],
  },
  async execute(input, context: ToolContext) {
    if (!isRecord(input) || typeof input.id !== "string") {
      return {
        output: "invalid input: expected { id: string; status?: string; description?: string }",
        isError: true,
      };
    }

    try {
      // Get the work item for this session
      const workItem = await getOrCreateWorkItemForSession(context.sessionId);
      
      const db = await getDatabaseConnection();
      
      // Verify that the task belongs to this session
      const task = await getTaskByIdRepo(db, input.id);
      if (!task || task.workItemId !== workItem.id) {
        return {
          output: `Task with ID ${input.id} not found or does not belong to this session`,
          isError: true,
        };
      }
      
      // Extract values with proper type checking
      const status = typeof input.status === "string" ? input.status : null;
      const description = typeof input.description === "string" ? input.description : null;
      
      // Update status if provided
      if (status) {
        await updateTaskStatusRepo(db, input.id, status);
        task.status = status;
      }
      
      // Update description if provided
      if (description) {
        // If the current description is structured JSON, update just the description part
        let newDescription = description;
        try {
          const parsed = JSON.parse(task.description);
          if (parsed && typeof parsed === 'object' && 'subject' in parsed && 'description' in parsed) {
            // It's structured data, update only the description part
            const updatedParsed = {
              ...parsed,
              description: description
            };
            newDescription = JSON.stringify(updatedParsed);
          }
        } catch {
          // If parsing fails, just use the new description directly
        }
        
        // Note: There's no direct update function for description in the repo,
        // so we'll need to use a direct update
        await db
          .update(tasks)
          .set({ description: newDescription })
          .where(eq(tasks.id, input.id));
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

    try {
      // Get the work item for this session
      const workItem = await getOrCreateWorkItemForSession(context.sessionId);
      
      const db = await getDatabaseConnection();
      
      // Get the task
      const task = await getTaskByIdRepo(db, input.id);
      
      if (!task || task.workItemId !== workItem.id) {
        return {
          output: `Task with ID ${input.id} not found or does not belong to this session`,
          isError: true,
        };
      }

      return {
        output: JSON.stringify({
          id: task.id,
          subject: (() => {
            try {
              // Try to parse the description as JSON to extract subject
              const parsed = JSON.parse(task.description);
              if (parsed && typeof parsed === 'object' && 'subject' in parsed) {
                return parsed.subject;
              }
            } catch {
              // If parsing fails, fall back to the raw description
            }
            // Fallback to raw description
            return task.description;
          })(),
          status: task.status,
          description: (() => {
            try {
              // Try to parse the description as JSON to extract description
              const parsed = JSON.parse(task.description);
              if (parsed && typeof parsed === 'object' && 'description' in parsed) {
                return parsed.description;
              }
            } catch {
              // If parsing fails, fall back to the raw description
            }
            // Fallback to raw description
            return task.description;
          })(),
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