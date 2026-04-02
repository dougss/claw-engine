import { describe, it, expect, vi, beforeEach } from "vitest";
import { notebookEditTool } from "../../../src/harness/tools/builtins/notebook-edit.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const mockContext = {
  workspacePath: "/workspace",
  sessionId: "test-session",
};

function makeNotebook(cells: object[]) {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells,
  });
}

function codeCell(source: string) {
  return {
    cell_type: "code",
    source,
    metadata: {},
    outputs: [],
    execution_count: null,
  };
}

function markdownCell(source: string) {
  return { cell_type: "markdown", source, metadata: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
});

describe("notebookEditTool", () => {
  describe("action: replace", () => {
    it("replaces cell content, preserving existing cellType", async () => {
      mockReadFile.mockResolvedValue(
        makeNotebook([codeCell("x = 1"), markdownCell("# Title")]) as any,
      );

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 0, action: "replace", content: "x = 2" },
        mockContext,
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("Replaced cell 0");
      expect(result.output).toContain("code");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.cells[0].source).toBe("x = 2");
      expect(written.cells[0].cell_type).toBe("code");
      expect(written.cells[1].source).toBe("# Title"); // unchanged
    });

    it("replaces cell type when cellType param is given", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x = 1")]) as any);

      const result = await notebookEditTool.execute(
        {
          path: "nb.ipynb",
          cellIndex: 0,
          action: "replace",
          content: "# Header",
          cellType: "markdown",
        },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.cells[0].cell_type).toBe("markdown");
      expect(written.cells[0].source).toBe("# Header");
    });

    it("returns error when content is missing for replace", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x = 1")]) as any);

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 0, action: "replace" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("content is required");
    });

    it("returns error when cellIndex is out of bounds", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x = 1")]) as any);

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 5, action: "replace", content: "y = 2" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("out of bounds");
    });
  });

  describe("action: insert", () => {
    it("inserts a new code cell at the given index, shifting others down", async () => {
      mockReadFile.mockResolvedValue(
        makeNotebook([codeCell("a = 1"), codeCell("b = 2")]) as any,
      );

      const result = await notebookEditTool.execute(
        {
          path: "nb.ipynb",
          cellIndex: 1,
          action: "insert",
          content: "c = 3",
          cellType: "code",
        },
        mockContext,
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("Inserted code cell at index 1");
      expect(result.output).toContain("3 cells");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.cells).toHaveLength(3);
      expect(written.cells[0].source).toBe("a = 1");
      expect(written.cells[1].source).toBe("c = 3");
      expect(written.cells[1].cell_type).toBe("code");
      expect(written.cells[2].source).toBe("b = 2");
    });

    it("inserts a markdown cell and appends at end when cellIndex equals length", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("a = 1")]) as any);

      const result = await notebookEditTool.execute(
        {
          path: "nb.ipynb",
          cellIndex: 1,
          action: "insert",
          content: "## Section",
          cellType: "markdown",
        },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.cells).toHaveLength(2);
      expect(written.cells[1].cell_type).toBe("markdown");
    });

    it("returns error when content is missing for insert", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x")]) as any);

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 0, action: "insert", cellType: "code" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("content is required");
    });

    it("returns error when cellType is missing for insert", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x")]) as any);

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 0, action: "insert", content: "y = 1" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("cellType is required");
    });

    it("returns error when cellIndex is beyond length", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x")]) as any);

      const result = await notebookEditTool.execute(
        {
          path: "nb.ipynb",
          cellIndex: 99,
          action: "insert",
          content: "y",
          cellType: "code",
        },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("out of bounds");
    });
  });

  describe("action: delete", () => {
    it("deletes the cell at the given index", async () => {
      mockReadFile.mockResolvedValue(
        makeNotebook([
          codeCell("a = 1"),
          codeCell("b = 2"),
          codeCell("c = 3"),
        ]) as any,
      );

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 1, action: "delete" },
        mockContext,
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("Deleted cell 1");
      expect(result.output).toContain("2 cells");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.cells).toHaveLength(2);
      expect(written.cells[0].source).toBe("a = 1");
      expect(written.cells[1].source).toBe("c = 3");
    });

    it("returns error when cellIndex is out of bounds for delete", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("a = 1")]) as any);

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 3, action: "delete" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("out of bounds");
    });
  });

  describe("error cases", () => {
    it("returns error for invalid input (missing required fields)", async () => {
      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", action: "replace" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("invalid input");
    });

    it("returns error for invalid action", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x")]) as any);

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 0, action: "upsert" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("invalid action");
    });

    it("returns error when file does not exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

      const result = await notebookEditTool.execute(
        { path: "missing.ipynb", cellIndex: 0, action: "delete" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("ENOENT");
    });

    it("returns error for invalid JSON in notebook file", async () => {
      mockReadFile.mockResolvedValue("not-valid-json" as any);

      const result = await notebookEditTool.execute(
        { path: "bad.ipynb", cellIndex: 0, action: "delete" },
        mockContext,
      );

      expect(result.isError).toBe(true);
    });

    it("returns error for notebook missing cells array", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {} }) as any,
      );

      const result = await notebookEditTool.execute(
        { path: "nb.ipynb", cellIndex: 0, action: "delete" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("missing cells array");
    });

    it("resolves relative path against workspacePath", async () => {
      mockReadFile.mockResolvedValue(makeNotebook([codeCell("x")]) as any);

      await notebookEditTool.execute(
        { path: "sub/nb.ipynb", cellIndex: 0, action: "delete" },
        mockContext,
      );

      expect(mockReadFile).toHaveBeenCalledWith(
        "/workspace/sub/nb.ipynb",
        "utf8",
      );
    });
  });
});
