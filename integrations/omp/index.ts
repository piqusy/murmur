import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

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
  orphaned?: boolean;
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

  // Add a murmur to a file's sidecar — the agent write API.
  pi.registerTool({
    name: "add_murmur",
    label: "Add Murmur",
    description:
      "Add a line annotation (murmur) to a file's sidecar. Generates UUID, timestamp, and line anchor automatically. The Neovim file watcher re-renders on change — no RPC needed.",
    parameters: Type.Object({
      filepath: Type.String({
        description: "Absolute or relative path of the file to annotate",
      }),
      line: Type.Integer({
        description: "1-indexed line number to annotate",
      }),
      author: Type.String({
        description: "Author name (e.g. \"Claude\", \"OMP\"). Anything other than \"User\" gets agent styling.",
      }),
      message: Type.String({
        description: "Annotation text — no length limit",
      }),
    }),
    async execute(_toolCallId, params) {
      const abs = path.isAbsolute(params.filepath)
        ? params.filepath
        : path.resolve(process.cwd(), params.filepath);
      const sidecar = abs + SIDECAR_SUFFIX;

      // Read source file for anchor (trimmed text of the target line)
      let anchor = "";
      try {
        const content = fs.readFileSync(abs, "utf-8");
        const lines = content.split("\n");
        anchor = (lines[params.line - 1] || "").trim();
      } catch {
        // file might not be readable; anchor stays empty
      }

      const id = randomUUID();
      const ts = new Date().toISOString();

      // Read existing murmurs (read-before-write discipline)
      let murmurs: Murmur[] = [];
      try {
        const raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
        if (isMurmurArray(raw)) murmurs = raw;
      } catch {
        // no existing sidecar or corrupt JSON — start fresh
      }

      // Append, sort by line, write atomically
      murmurs.push({
        id,
        line: params.line,
        anchor,
        author: params.author,
        message: params.message,
        created_at: ts,
        orphaned: false,
      });
      murmurs.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

      const tmp = sidecar + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(murmurs, null, 2));
      fs.renameSync(tmp, sidecar);

      return {
        content: [{ type: "text" as const, text: `Added murmur at ${params.filepath}:${params.line} [${params.author}] ${params.message}` }],
        details: { ok: true },
      };
    },
  });

  // Delete all murmurs in a single file (removes the sidecar).
  pi.registerTool({
    name: "delete_file_murmurs",
    label: "Delete File Murmurs",
    description:
      "Delete all murmurs in a single file by removing its sidecar. Returns the count of murmurs removed.",
    parameters: Type.Object({
      filepath: Type.String({
        description: "Absolute or relative path of the file whose murmurs to delete",
      }),
    }),
    async execute(_toolCallId, params) {
      const abs = path.isAbsolute(params.filepath)
        ? params.filepath
        : path.resolve(process.cwd(), params.filepath);
      const sidecar = abs + SIDECAR_SUFFIX;

      let count = 0;
      try {
        const raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
        if (Array.isArray(raw)) count = raw.length;
      } catch {
        // no sidecar or corrupt JSON — count stays 0
      }
      try {
        fs.unlinkSync(sidecar);
      } catch {
        // already gone
      }

      return {
        content: [{ type: "text" as const, text: count > 0 ? `Deleted ${count} murmur(s) from ${params.filepath}` : `No murmurs found for ${params.filepath}` }],
        details: { ok: true, count },
      };
    },
  });

  // Delete all murmur sidecars in the project.
  pi.registerTool({
    name: "delete_all_murmurs",
    label: "Delete All Murmurs",
    description:
      "Delete all murmur sidecar files in the project. Returns the total count of files removed.",
    parameters: Type.Object({
      dir: Type.Optional(Type.String({
        description: "Root directory to scan (defaults to cwd)",
      })),
    }),
    async execute(_toolCallId, params) {
      const dir = params.dir || process.cwd();
      const sidecars = globMurmurs(dir);
      let count = 0;
      for (const sc of sidecars) {
        try {
          fs.unlinkSync(sc);
          count++;
        } catch {
          // ignore individual failures
        }
      }

      return {
        content: [{ type: "text" as const, text: `Deleted ${count} sidecar file(s) under ${dir}` }],
        details: { ok: true, count },
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
