import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  taskCreateTool,
  taskListTool,
  taskUpdateTool,
  taskGetTool,
} from "../../../src/harness/tools/builtins/task-tools.js";
import { randomUUID } from "node:crypto";

const mockDb = {};

vi.mock("../../../src/storage/db.js", () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock("../../../src/storage/repositories/tasks-repo.js", () => ({
  createTask: vi.fn((db, input) => mockCreateTask(db, input)),
  getTaskById: vi.fn((db, id) => mockGetTaskById(db, id)),
  getTasksByWorkItemId: vi.fn((db, workItemId) =>
    mockGetTasksByWorkItemId(db, workItemId),
  ),
  updateTaskStatus: vi.fn((db, id, status) =>
    mockUpdateTaskStatus(db, id, status),
  ),
  getTaskCheckpointData: vi.fn((db, id) => mockGetTaskCheckpointData(db, id)),
  setTaskCheckpointData: vi.fn((db, id, data) =>
    mockSetTaskCheckpointData(db, id, data),
  ),
}));

const mockTasks = new Map<string, any>();

const mockCreateTask = (_db: any, input: any) => {
  const id = randomUUID();
  const task = {
    id,
    workItemId: input.workItemId,
    repo: input.repo,
    branch: input.branch,
    description: input.description,
    complexity: input.complexity,
    dagNodeId: input.dagNodeId,
    status: "pending",
    checkpointData: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
  mockTasks.set(id, task);
  return Promise.resolve(task);
};

const mockGetTaskById = (_db: any, id: string) =>
  Promise.resolve(mockTasks.get(id) ?? null);

const mockGetTasksByWorkItemId = (_db: any, workItemId: string) =>
  Promise.resolve(
    Array.from(mockTasks.values()).filter((t) => t.workItemId === workItemId),
  );

const mockUpdateTaskStatus = (_db: any, id: string, status: string) => {
  const task = mockTasks.get(id);
  if (task) task.status = status;
  return Promise.resolve(task);
};

const mockGetTaskCheckpointData = (_db: any, id: string) => {
  const task = mockTasks.get(id);
  return Promise.resolve(task?.checkpointData ?? null);
};

const mockSetTaskCheckpointData = (_db: any, id: string, data: any) => {
  const task = mockTasks.get(id);
  if (task) task.checkpointData = data;
  return Promise.resolve();
};

describe("Task Tools", () => {
  const mockContext = {
    workspacePath: "/tmp/test",
    sessionId: "session-test-123",
    workItemId: "workitem-test-abc",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTasks.clear();
  });

  describe("task_create", () => {
    it("should create a new task with minimal input", async () => {
      const result = await taskCreateTool.execute(
        { subject: "Test task" },
        mockContext,
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
          status: "in_progress",
        },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output.subject).toBe("Test task");
      expect(output.status).toBe("in_progress");
    });

    it("should store subject in description column, not JSON", async () => {
      await taskCreateTool.execute({ subject: "Plain subject" }, mockContext);
      const stored = Array.from(mockTasks.values())[0];
      expect(stored.description).toBe("Plain subject");
    });

    it("should store agentDescription in checkpointData", async () => {
      await taskCreateTool.execute(
        { subject: "Task", description: "Detailed desc" },
        mockContext,
      );
      const stored = Array.from(mockTasks.values())[0];
      expect(stored.checkpointData).toEqual({
        agentDescription: "Detailed desc",
      });
    });

    it("should return error for invalid input", async () => {
      const result = await taskCreateTool.execute(
        { description: "Missing subject" },
        mockContext,
      );
      expect(result.isError).toBe(true);
    });

    it("should return error when workItemId is missing from context", async () => {
      const result = await taskCreateTool.execute(
        { subject: "Task" },
        { workspacePath: "/tmp", sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
      expect(result.output).toMatch(/workItemId/);
    });
  });

  describe("task_list", () => {
    it("should list all tasks", async () => {
      await taskCreateTool.execute({ subject: "Task 1" }, mockContext);
      await taskCreateTool.execute({ subject: "Task 2" }, mockContext);

      const result = await taskListTool.execute({}, mockContext);

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output).toHaveLength(2);
      expect(output.some((t: any) => t.subject === "Task 1")).toBe(true);
      expect(output.some((t: any) => t.subject === "Task 2")).toBe(true);
    });

    it("should include description from checkpointData when present", async () => {
      await taskCreateTool.execute(
        { subject: "Task", description: "My desc" },
        mockContext,
      );

      const result = await taskListTool.execute({}, mockContext);
      const output = JSON.parse(result.output);
      expect(output[0].description).toBe("My desc");
    });

    it("should filter tasks by status", async () => {
      await taskCreateTool.execute(
        { subject: "Task 1", status: "pending" },
        mockContext,
      );
      await taskCreateTool.execute(
        { subject: "Task 2", status: "completed" },
        mockContext,
      );

      const result = await taskListTool.execute(
        { status: "completed" },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output).toHaveLength(1);
      expect(output[0].status).toBe("completed");
    });

    it("should return empty array when no tasks match filter", async () => {
      await taskCreateTool.execute(
        { subject: "Task 1", status: "pending" },
        mockContext,
      );

      const result = await taskListTool.execute(
        { status: "completed" },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const output = JSON.parse(result.output);
      expect(output).toHaveLength(0);
    });
  });

  describe("task_update", () => {
    it("should update task status", async () => {
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", status: "pending" },
        mockContext,
      );
      const task = JSON.parse(createResult.output);

      const updateResult = await taskUpdateTool.execute(
        { id: task.id, status: "completed" },
        mockContext,
      );

      expect(updateResult.isError).toBe(false);
      const updatedTask = JSON.parse(updateResult.output);
      expect(updatedTask.status).toBe("completed");
    });

    it("should return subject (not JSON) from description column", async () => {
      const createResult = await taskCreateTool.execute(
        { subject: "My Subject" },
        mockContext,
      );
      const task = JSON.parse(createResult.output);

      const updateResult = await taskUpdateTool.execute(
        { id: task.id, status: "in_progress" },
        mockContext,
      );

      expect(updateResult.isError).toBe(false);
      const updatedTask = JSON.parse(updateResult.output);
      expect(updatedTask.subject).toBe("My Subject");
    });

    it("should update agentDescription in checkpointData", async () => {
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", description: "Original description" },
        mockContext,
      );
      const task = JSON.parse(createResult.output);

      const updateResult = await taskUpdateTool.execute(
        { id: task.id, description: "Updated description" },
        mockContext,
      );

      expect(updateResult.isError).toBe(false);
      const stored = mockTasks.get(task.id);
      expect(stored.checkpointData.agentDescription).toBe(
        "Updated description",
      );
    });

    it("should update both status and description", async () => {
      const createResult = await taskCreateTool.execute(
        { subject: "Test task", status: "pending", description: "Original" },
        mockContext,
      );
      const task = JSON.parse(createResult.output);

      const updateResult = await taskUpdateTool.execute(
        {
          id: task.id,
          status: "in_progress",
          description: "Updated description",
        },
        mockContext,
      );

      expect(updateResult.isError).toBe(false);
      const updatedTask = JSON.parse(updateResult.output);
      expect(updatedTask.status).toBe("in_progress");
    });

    it("should return error for non-existent task", async () => {
      const result = await taskUpdateTool.execute(
        { id: "non-existent-id", status: "completed" },
        mockContext,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe("task_get", () => {
    it("should retrieve a task by ID", async () => {
      const createResult = await taskCreateTool.execute(
        {
          subject: "Test task",
          description: "A detailed description",
          status: "in_progress",
        },
        mockContext,
      );
      const createdTask = JSON.parse(createResult.output);

      const getResult = await taskGetTool.execute(
        { id: createdTask.id },
        mockContext,
      );

      expect(getResult.isError).toBe(false);
      const retrievedTask = JSON.parse(getResult.output);
      expect(retrievedTask.id).toBe(createdTask.id);
      expect(retrievedTask.subject).toBe("Test task");
      expect(retrievedTask.status).toBe("in_progress");
      expect(retrievedTask.description).toBe("A detailed description");
    });

    it("should return null description when not set", async () => {
      const createResult = await taskCreateTool.execute(
        { subject: "No desc task" },
        mockContext,
      );
      const createdTask = JSON.parse(createResult.output);

      const getResult = await taskGetTool.execute(
        { id: createdTask.id },
        mockContext,
      );

      expect(getResult.isError).toBe(false);
      const retrievedTask = JSON.parse(getResult.output);
      expect(retrievedTask.description).toBeNull();
    });

    it("should return error for non-existent task", async () => {
      const result = await taskGetTool.execute(
        { id: "non-existent-id" },
        mockContext,
      );
      expect(result.isError).toBe(true);
    });
  });
});
