import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function clampMaxBytes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 51200;
  return Math.max(1, Math.min(1024 * 1024, Math.floor(value)));
}

function stripHtmlToText(html: string) {
  const withoutScripts = html
    .replaceAll(/<script[\s\S]*?<\/script>/gi, "\n")
    .replaceAll(/<style[\s\S]*?<\/style>/gi, "\n");

  return withoutScripts
    .replaceAll(/<[^>]+>/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateUtf8({ text, maxBytes }: { text: string; maxBytes: number }) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return Buffer.from(buf.subarray(0, maxBytes)).toString("utf8");
}

export const webFetchTool: ToolHandler = {
  name: "web_fetch",
  isConcurrencySafe: true,
  description: "Fetch a URL and return its contents as text",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      maxBytes: { type: "number" },
    },
    required: ["url"],
  },
  async execute(input) {
    if (!isRecord(input) || typeof input.url !== "string") {
      return {
        output: "invalid input: expected { url: string; maxBytes?: number }",
        isError: true,
      };
    }

    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return { output: "invalid url", isError: true };
    }

    const maxBytes = clampMaxBytes(input.maxBytes);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(url.toString(), {
        redirect: "follow",
        headers: { "user-agent": "claw-engine/0.1" },
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          output: `request failed: ${res.status} ${res.statusText}`,
          isError: true,
        };
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

      if (contentType.includes("application/json")) {
        const json = await res.json();
        const text = truncateUtf8({
          text: JSON.stringify(json, null, 2),
          maxBytes,
        });
        return { output: text, isError: false };
      }

      const raw = await res.text();
      const text =
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml")
          ? stripHtmlToText(raw)
          : raw;

      return { output: truncateUtf8({ text, maxBytes }), isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    } finally {
      clearTimeout(timer);
    }
  },
};
