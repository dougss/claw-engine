import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskCreateTool, taskListTool, taskUpdateTool, taskGetTool, __overrideGetDatabaseConnection } from "../../../src/harness/tools/builtins/task-tools.js";
import { randomUUID } from "node:crypto";

// Mock the database functions
vi.mock("../../../src/storage/db.js", () => {
  return {
    getDb: vi.fn(() => mockDb),
  };
});

vi.mock("../../../src/storage/repositories/tasks-repo.js", async () => {
  return {
    createTask: vi.fn((db, input) => mockCreateTask(db, input)),
    getTaskById: vi.fn((db, id) => mockGetTaskById(db, id)),
    getTasksByWorkItemId: vi.fn((db, workItemId) => mockGetTasksByWorkItemId(db, workItemId)),
    updateTaskStatus: vi.fn((db, id, status) => mockUpdateTaskStatus(db, id, status)),
  };
});

vi.mock("../../../src/storage/repositories/work-items-repo.js", () => {
  return {
    createWorkItem: vi.fn((db, input) => mockCreateWorkItem(db, input)),
    getWorkItemById: vi.fn((db, id) => mockGetWorkItemById(db, id)),
  };
});

// Mock implementations
const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([]))
    }))
  })),
  sql: vi.fn((strings, ...params) => ({ strings, params })),
};

const mockTasks = new Map();
const mockWorkItems = new Map(); // Map of workItemId -> workItem
const mockSessionWorkItems = new Map(); // Map of sessionId -> workItemId

let nextId = 1;

const mockCreateTask = (db: any, input: any) => {
  const id = randomUUID();
  const task = {
    id,
    workItemId: input.workItemId,
    repo: input.repo,
    branch: input.branch,
    description: input.description,
    complexity: input.complexity,
    dagNodeId: input.dagNodeId,
    status: input.status || "pending",
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
  mockTasks.set(id, task);
  return Promise.resolve(task);
};

const mockGetTaskById = (db: any, id: string) => {
  return Promise.resolve(mockTasks.get(id) || null);
};

const mockGetTasksByWorkItemId = (db: any, workItemId: string) => {
  const tasks = Array.from(mockTasks.values()).filter(task => task.workItemId === workItemId);
  return Promise.resolve(tasks);
};

const mockUpdateTaskStatus = (db: any, id: string, status: string) => {
  const task = mockTasks.get(id);
  if (task) {
    task.status = status;
  }
  return Promise.resolve(task);
};

const mockCreateWorkItem = (db: any, input: any) => {
  const id = `workitem-${nextId++}`;
  const workItem = {
    id,
    title: input.title,
    description: input.description,
    repos: input.repos,
    source: input.source,
  };
  mockWorkItems.set(id, workItem);
  // Store the session mapping
  if (input.title.includes('session:')) {
    const sessionId = input.title.split(':')[1]; // Extract session ID from "Tasks for session:{sessionId}"
    mockSessionWorkItems.set(sessionId, id);
  }
  return Promise.resolve(workItem);
};

const mockGetWorkItemById = (db: any, id: string) => {
  return Promise.resolve(mockWorkItems.get(id) || null);
};

describe("Task Tools", () => {
  const mockContext = {
    workspacePath: "/tmp/test",
    sessionId: "session-test-123",
  };

  beforeEach(() => {
    // Set up the database connection override
    __overrideGetDatabaseConnection(() => mockDb);
    
    // Clear mocks and data
    vi.clearAllMocks();
    mockTasks.clear();
    mockWorkItems.clear();
    nextId = 1;
    
    // Set up the execute method to return a work item
    mockDb.execute.mockImplementation((query: any) => {
      if (typeof query === 'object' && query.strings && query.strings[0]?.includes('work_items')) {
        return Promise.resolve({ rowCount: 0, rows: [] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    
    // Mock the select method to simulate Drizzle ORM behavior
    // We need to make it return the right value based on the session
    mockDb.select = vi.fn(function(columns) {
      return {
        from: vi.fn(() => ({
          where: vi.fn((conditionObj) => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => {
                // Look for work item matching the current session
                const workItemId = mockSessionWorkItems.get(mockContext.sessionId);
                if (workItemId) {
                  // Return the existing work item
                  return Promise.resolve([{ id: workItemId }]);
                } else {
                  // No work item found for this session
                  return Promise.resolve([]);
                }
              })
            }))
          }))
        }))
      };
    });
    
    // Also need to mock the update method properly
    mockDb.update = vi.fn((table) => ({
      set: vi.fn((values) => ({
        where: vi.fn(() => Promise.resolve([]))
      }))
    }));
  });

  afterEach(() => {
    // Reset the override after each test
    __overrideGetDatabaseConnection(null as any);
  });

  describe("task_create", () => {
    it("should create a new task with minimal input", async () => {
      const result = await taskCreateTool.execute(
        { subject: "Test task" },
        mockContext
      );

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output.subject).toBe("Test task");
      expect(output.status).toBe("pending");
      expect(typeof output.id).toBe("string");
    });

    it("should create a task with description and status", async () => {
      const result = await taskCreateTool.execute(
        { 
          subject: "Test task", 
          description: "This is a test task", 
          status: "in_progress" 
        },
        mockContext
      );

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output.subject).toBe("Test task");
      expect(output.status).toBe("in_progress");
    });

    it("should return error for invalid input", async () => {
      const result = await taskCreateTool.execute(
        { description: "Missing subject" },
        mockContext
      );

      expect(result.isError).toBe(true);
    });
  });

  describe("task_list", () => {
    it("should list all tasks", async () => {
      // Create some test tasks
      await taskCreateTool.execute({ subject: "Task 1" }, mockContext);
      await taskCreateTool.execute({ subject: "Task 2" }, mockContext);

      const result = await taskListTool.execute({}, mockContext);

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output).toHaveLength(2);
      expect(output.some((t: any) => t.subject === "Task 1")).toBe(true);
      expect(output.some((t: any) => t.subject === "Task 2")).toBe(true);
    });

    it("should filter tasks by status", async () => {
      // Create tasks with different statuses
      await taskCreateTool.execute({ subject: "Task 1", status: "pending" }, mockContext);
      await taskCreateTool.execute({ subject: "Task 2", status: "completed" }, mockContext);

      const result = await taskListTool.execute({ status: "completed" }, mockContext);

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output).toHaveLength(1);
      expect(output[0].status).toBe("completed");
    });

    it("should return empty array when no tasks match filter", async () => {
      await taskCreateTool.execute({ subject: "Task 1", status: "pending" }, mockContext);

      const result = await taskListTool.execute({ status: "completed" }, mockContext);

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output).toHaveLength(0);
    });
  });

  describe("task_update", () => {
    it("should update task status", async () => {
      // Create a task first
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", status: "pending" },
        mockContext
      );
      const task = JSON.parse(createResult.output);

      // Update the task
      const updateResult = await taskUpdateTool.execute(
        { id: task.id, status: "completed" },
        mockContext
      );

      expect(updateResult.isError).toBe(false);
      const updatedTask = JSON.parse(updateResult.output);
      expect(updatedTask.status).toBe("completed");
    });

    it("should update task description", async () => {
      // Create a task first
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", description: "Original description" },
        mockContext
      );
      const task = JSON.parse(createResult.output);

      // Update the task description
      const updateResult = await taskUpdateTool.execute(
        { id: task.id, description: "Updated description" },
        mockContext
      );

      expect(updateResult.isError).toBe(false);
    });

    it("should update both status and description", async () => {
      // Create a task first
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", status: "pending", description: "Original" },
        mockContext
      );
      const task = JSON.parse(createResult.output);

      // Update both fields
      const updateResult = await taskUpdateTool.execute(
        { id: task.id, status: "in_progress", description: "Updated description" },
        mockContext
      );

      expect(updateResult.isError).toBe(false);
      const updatedTask = JSON.parse(updateResult.output);
      expect(updatedTask.status).toBe("in_progress");
    });

    it("should return error for non-existent task", async () => {
      const result = await taskUpdateTool.execute(
        { id: "non-existent-id", status: "completed" },
        mockContext
      );

      expect(result.isError).toBe(true);
    });
  });

  describe("task_get", () => {
    it("should retrieve a task by ID", async () => {
      // Create a task first
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", description: "A detailed description", status: "in_progress" },
        mockContext
      );
      const createdTask = JSON.parse(createResult.output);

      // Get the task
      const getResult = await taskGetTool.execute(
        { id: createdTask.id },
        mockContext
      );

      expect(getResult.isError).toBe(false);
      const retrievedTask = JSON.parse(getResult.output);
      expect(retrievedTask.id).toBe(createdTask.id);
      expect(retrievedTask.subject).toBe("Test task");
      expect(retrievedTask.status).toBe("in_progress");
      expect(retrievedTask.description).toBe("A detailed description");
    });

    it("should return error for non-existent task", async () => {
      const result = await taskGetTool.execute(
        { id: "non-existent-id" },
        mockContext
      );

      expect(result.isError).toBe(true);
    });
  });
});