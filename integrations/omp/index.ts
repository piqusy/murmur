import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

// Directories never scanned for .murmur.json sidecars.
const IGNORE_DIRS: Record<string, true> = {
  ".git": true,
  "node_modules": true,
  ".venv": true,
  "vendor": true,
  "dist": true,
  "build": true,
  ".next": true,
};

const SIDECAR_SUFFIX = ".murmur.json";
// Max path depth (dir segments + filename) for a sidecar to be auto-injected.
const MAX_DEPTH = 6;

interface Murmur {
  id?: string;
  line?: number;
  anchor?: string;
  author?: string;
  message?: string;
  created_at?: string;
}

// Validate that parsed sidecar JSON is an array of murmur-shaped objects.
function isMurmurArray(value: unknown): value is Murmur[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item): item is Murmur => item !== null && typeof item === "object",
  );
}

function globMurmurs(root: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    if (!entry.endsWith(SIDECAR_SUFFIX)) continue;
    const segs = entry.split(path.sep);
    if (segs.length > MAX_DEPTH) continue;
    if (segs.some((s) => IGNORE_DIRS[s])) continue;
    out.push(path.join(root, entry));
  }
  return out;
}

function formatSidecar(sidecarPath: string, cwd: string): string | null {
  const base = sidecarPath.slice(0, -SIDECAR_SUFFIX.length);
  if (!fs.existsSync(base)) return null; // source file deleted → orphan sidecar
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
  } catch {
    return null;
  }
  if (!isMurmurArray(raw) || raw.length === 0) return null;
  const murmurs = raw;
  const rel = path.relative(cwd, base) || base;
  const lines = murmurs.map((m) =>
    `- ${rel}:${m.line ?? "?"} [${m.author ?? "User"}] ${m.message ?? ""} (anchored: "${(m.anchor ?? "").trim()}")`,
  );
  return lines.join("\n");
}

export default function murmurExtension(pi: ExtensionAPI): void {
  // Auto-inject every project murmur into the system prompt at session start.
  // This is the reliable delivery path — the agent cannot skip it.
  pi.on("before_agent_start", async (event) => {
    const cwd = event.systemPromptOptions?.cwd || process.cwd();
    const sidecars = globMurmurs(cwd);
    const blocks: string[] = [];
    for (const sc of sidecars) {
      const block = formatSidecar(sc, cwd);
      if (block) blocks.push(block);
    }
    if (blocks.length === 0) return; // zero noise when no murmurs exist
    const block = [
      "Murmurs — user-pinned line constraints in this project. Honor these when editing the named files:",
      ...blocks,
    ].join("\n");
    return {
      systemPrompt: [event.systemPrompt, block].filter(Boolean).join("\n\n"),
    };
  });

  // Per-file lookup — fallback for murmurs added mid-session after before_agent_start fired.
  pi.registerTool({
    name: "read_murmur",
    label: "Read Murmurs",
    description:
      "Read user-pinned line constraints for a file before editing it. Always call before modifying a file.",
    parameters: Type.Object({
      filepath: Type.String({
        description: "Absolute or relative path of the file you intend to modify",
      }),
    }),
    async execute(_toolCallId, params) {
      const abs = path.isAbsolute(params.filepath)
        ? params.filepath
        : path.resolve(process.cwd(), params.filepath);
      const sidecar = abs + SIDECAR_SUFFIX;
      if (!fs.existsSync(sidecar)) {
        return {
          content: [{ type: "text" as const, text: `No murmurs for ${params.filepath}. Clear to edit.` }],
          details: { ok: true, murmurs: [] },
        };
      }
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
      } catch {
        raw = [];
      }
      if (!isMurmurArray(raw) || raw.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No murmurs for ${params.filepath}. Clear to edit.` }],
          details: { ok: true, murmurs: [] },
        };
      }
      const murmurs = raw;
      const lines = murmurs
        .map((m) => `- L${m.line ?? "?"} [${m.author ?? "User"}] ${m.message ?? ""} (anchored: "${(m.anchor ?? "").trim()}")`)
        .join("\n");
      return {
        content: [{ type: "text" as const, text: `Murmurs for ${params.filepath}:\n${lines}` }],
        details: { ok: true, murmurs },
      };
    },
  });

  // Manual rescan slash command (mirrors agentmemory-status pattern).
  pi.registerCommand("murmur-scan", {
    description: "Scan the project for .murmur.json sidecars and report the count",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const sidecars = globMurmurs(cwd);
      ctx.ui.notify(
        sidecars.length > 0 ? `Found ${sidecars.length} murmur sidecar(s)` : "No murmur sidecars found",
        "info",
      );
    },
  });
}
