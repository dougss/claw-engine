import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata?: Record<string, unknown>;
  cells: NotebookCell[];
}

function makeCell(
  content: string,
  cellType: "code" | "markdown",
): NotebookCell {
  const cell: NotebookCell = {
    cell_type: cellType,
    source: content,
    metadata: {},
  };
  if (cellType === "code") {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return cell;
}

export const notebookEditTool: ToolHandler = {
  name: "notebook_edit",
  description:
    'Edit a Jupyter notebook cell. Actions: replace, insert, delete. Example: {"path": "notebook.ipynb", "cellIndex": 0, "action": "replace", "content": "print(\\"hello\\")"}',
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the .ipynb file (relative to workspace root)",
      },
      cellIndex: {
        type: "number",
        description: "Zero-based index of the target cell",
      },
      action: {
        type: "string",
        enum: ["replace", "insert", "delete"],
        description: "Operation to perform on the cell",
      },
      content: {
        type: "string",
        description:
          "New cell content (required for replace and insert actions)",
      },
      cellType: {
        type: "string",
        enum: ["code", "markdown"],
        description:
          "Cell type for insert action, or to override type on replace",
      },
    },
    required: ["path", "cellIndex", "action"],
  },

  async execute(input, context) {
    if (
      !isRecord(input) ||
      typeof input.path !== "string" ||
      typeof input.cellIndex !== "number" ||
      typeof input.action !== "string"
    ) {
      return {
        output:
          "invalid input: expected { path: string, cellIndex: number, action: string }",
        isError: true,
      };
    }

    const action = input.action;
    if (action !== "replace" && action !== "insert" && action !== "delete") {
      return {
        output: "invalid action: must be one of replace, insert, delete",
        isError: true,
      };
    }

    const cellIndex = Math.floor(input.cellIndex);
    if (!Number.isFinite(cellIndex) || cellIndex < 0) {
      return {
        output: "invalid cellIndex: must be a non-negative integer",
        isError: true,
      };
    }

    const content =
      typeof input.content === "string" ? input.content : undefined;
    const cellType =
      input.cellType === "code" || input.cellType === "markdown"
        ? input.cellType
        : undefined;

    // Validate required params per action
    if (
      (action === "replace" || action === "insert") &&
      content === undefined
    ) {
      return {
        output: `content is required for action '${action}'`,
        isError: true,
      };
    }
    if (action === "insert" && cellType === undefined) {
      return {
        output: "cellType is required for action 'insert'",
        isError: true,
      };
    }

    const filePath = path.isAbsolute(input.path)
      ? input.path
      : path.join(context.workspacePath, input.path);

    let notebook: Notebook;
    try {
      const raw = await readFile(filePath, "utf8");
      notebook = JSON.parse(raw) as Notebook;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }

    if (!Array.isArray(notebook.cells)) {
      return {
        output: "invalid notebook: missing cells array",
        isError: true,
      };
    }

    const cells = notebook.cells;

    if (action === "delete" || action === "replace") {
      if (cellIndex >= cells.length) {
        return {
          output: `cellIndex ${cellIndex} is out of bounds (notebook has ${cells.length} cell${cells.length === 1 ? "" : "s"})`,
          isError: true,
        };
      }
    } else {
      // insert: allow inserting at cells.length (append)
      if (cellIndex > cells.length) {
        return {
          output: `cellIndex ${cellIndex} is out of bounds (notebook has ${cells.length} cell${cells.length === 1 ? "" : "s"})`,
          isError: true,
        };
      }
    }

    let summary: string;

    if (action === "replace") {
      const existing = cells[cellIndex];
      const resolvedType =
        cellType ??
        (existing.cell_type === "code" || existing.cell_type === "markdown"
          ? existing.cell_type
          : "code");
      cells[cellIndex] = makeCell(content!, resolvedType);
      summary = `Replaced cell ${cellIndex} (type: ${resolvedType})`;
    } else if (action === "insert") {
      const newCell = makeCell(content!, cellType!);
      cells.splice(cellIndex, 0, newCell);
      summary = `Inserted ${cellType} cell at index ${cellIndex} (notebook now has ${cells.length} cells)`;
    } else {
      // delete
      cells.splice(cellIndex, 1);
      summary = `Deleted cell ${cellIndex} (notebook now has ${cells.length} cell${cells.length === 1 ? "" : "s"})`;
    }

    try {
      await writeFile(filePath, JSON.stringify(notebook, null, 1), "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }

    return { output: summary, isError: false };
  },
};
