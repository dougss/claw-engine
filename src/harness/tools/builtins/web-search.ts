import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function clampMaxResults(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function extractTopics(
  items: unknown[],
): Array<{ text: string; url?: string }> {
  const out: Array<{ text: string; url?: string }> = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    if (Array.isArray(rec.Topics)) {
      out.push(...extractTopics(rec.Topics));
      continue;
    }

    const text = typeof rec.Text === "string" ? rec.Text : "";
    const url = typeof rec.FirstURL === "string" ? rec.FirstURL : undefined;
    if (text.trim().length > 0) out.push({ text, url });
  }

  return out;
}

export const webSearchTool: ToolHandler = {
  name: "web_search",
  description:
    "Search the web (DuckDuckGo Instant Answer API) and return a short text summary",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxResults: { type: "number" },
    },
    required: ["query"],
  },
  async execute(input) {
    if (!isRecord(input) || typeof input.query !== "string") {
      return {
        output:
          "invalid input: expected { query: string; maxResults?: number }",
        isError: true,
      };
    }

    const query = input.query.trim();
    if (query.length === 0) {
      return { output: "query must not be empty", isError: true };
    }

    const maxResults = clampMaxResults(input.maxResults);

    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
        query,
      )}&format=json&no_html=1&skip_disambig=1`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "claw-engine/0.1" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          output: `request failed: ${res.status} ${res.statusText}`,
          isError: true,
        };
      }

      const data = (await res.json()) as {
        AbstractText?: unknown;
        RelatedTopics?: unknown;
      };

      const abstract =
        typeof data.AbstractText === "string" ? data.AbstractText.trim() : "";

      const relatedTopics = Array.isArray(data.RelatedTopics)
        ? extractTopics(data.RelatedTopics).slice(0, maxResults)
        : [];

      if (!abstract && relatedTopics.length === 0) {
        return {
          output:
            "No instant answers found. Try using web_fetch on a specific URL for detailed content.",
          isError: false,
        };
      }

      const lines: string[] = [];
      if (abstract) {
        lines.push(`Abstract: ${abstract}`);
      }

      if (relatedTopics.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("Related:");
        for (const topic of relatedTopics) {
          lines.push(
            topic.url ? `- ${topic.text} — ${topic.url}` : `- ${topic.text}`,
          );
        }
      }

      return { output: lines.join("\n"), isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};
