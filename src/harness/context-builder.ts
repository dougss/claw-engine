import type { Message, ToolDefinition } from "../types.js";

export interface TaskInput {
  description: string;
  contextFilter: string[];
  nexusSkills: string[];
}

export interface Checkpoint {
  summary: string;
  recentMessages: Message[];
}

function normalizeHeadingText(text: string): string {
  return text.trim().toLowerCase();
}

function isHeadingLine(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: match[2].trim() };
}

function sliceFirstLines({
  text,
  maxLines,
}: {
  text: string;
  maxLines: number;
}): string {
  return text.split("\n").slice(0, maxLines).join("\n");
}

function extractHeadingSections({
  markdown,
  contextFilter,
}: {
  markdown: string;
  contextFilter: string[];
}): string {
  const wanted = new Set(contextFilter.map(normalizeHeadingText));
  if (wanted.size === 0) return "";

  const lines = markdown.split("\n");
  const slices: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = isHeadingLine(lines[i]);
    if (!heading) continue;

    if (!wanted.has(normalizeHeadingText(heading.text))) continue;

    const start = i;
    let end = lines.length;

    for (let j = i + 1; j < lines.length; j++) {
      const nextHeading = isHeadingLine(lines[j]);
      if (!nextHeading) continue;
      if (nextHeading.level === heading.level) {
        end = j;
        break;
      }
    }

    slices.push({ start, end });
  }

  if (slices.length === 0) return "";

  const merged: Array<{ start: number; end: number }> = [];
  for (const slice of slices.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(slice);
      continue;
    }
    if (slice.start <= last.end) {
      last.end = Math.max(last.end, slice.end);
      continue;
    }
    merged.push(slice);
  }

  return merged
    .map(({ start, end }) => lines.slice(start, end).join("\n"))
    .join("\n\n");
}

export function buildSystemPrompt({
  task,
  tools,
  projectContext,
  checkpoint,
}: {
  task: TaskInput;
  tools: ToolDefinition[];
  projectContext: string;
  checkpoint?: Checkpoint;
}): string {
  const identityLayer = [
    "IDENTITY",
    "You are a coding agent.",
    "Follow instructions precisely and stay deterministic.",
  ].join("\n");

  const toolsLayer = ["TOOLS", JSON.stringify(tools, null, 2)].join("\n");

  const taskContextLayer = ["TASK CONTEXT", task.description].join("\n");

  const filteredProjectContext =
    extractHeadingSections({
      markdown: projectContext,
      contextFilter: task.contextFilter,
    }) || sliceFirstLines({ text: projectContext, maxLines: 50 });

  const projectContextLayer = ["PROJECT CONTEXT", filteredProjectContext].join(
    "\n",
  );

  const nexusSkillsLayer = [
    "NEXUS SKILLS",
    JSON.stringify(
      {
        skills: task.nexusSkills,
        note: "Skill contents will be injected here in a future task.",
      },
      null,
      2,
    ),
  ].join("\n");

  const checkpointLayer = checkpoint
    ? [
        "CHECKPOINT",
        JSON.stringify(
          {
            summary: checkpoint.summary,
            recentMessages: checkpoint.recentMessages,
          },
          null,
          2,
        ),
      ].join("\n")
    : "";

  return [
    identityLayer,
    toolsLayer,
    taskContextLayer,
    projectContextLayer,
    nexusSkillsLayer,
    checkpointLayer,
  ]
    .filter((layer) => layer.length > 0)
    .join("\n\n---\n\n");
}
