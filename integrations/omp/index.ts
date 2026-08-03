import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  formatMurmurBatch,
  getMurmurSidecarFingerprint,
  isMurmurArray,
  readMurmurFiles,
  scanMurmurFiles,
  SIDECAR_SUFFIX,
  type Murmur,
} from "../shared/murmur-core.ts";

// File-modifying tools whose arguments we should preflight for murmurs.
const FILE_WRITING_TOOL_NAMES = new Set<string>([
  "edit",
  "write",
  "multiedit",
  "read",
]);

type FileWritingToolName = "edit" | "write" | "multiedit" | "read";

interface FileWritingInput {
  toolName: FileWritingToolName;
  input: Record<string, unknown>;
}

function isFileWritingToolName(value: string): value is FileWritingToolName {
  return (FILE_WRITING_TOOL_NAMES as ReadonlySet<string>).has(value);
}

function readStringField(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function readPathListField(input: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return [value];
    if (Array.isArray(value)) {
      const paths = value.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      );
      if (paths.length > 0) return paths;
    }
  }
  return [];
}

function getModifiedFilepathsFromEditInput(input: Record<string, unknown>): string[] {
  // hashline multi-section inputs embed paths in bracketed [PATH#TAG] headers.
  const editInput = typeof input.input === "string" ? input.input : "";
  if (editInput.includes("[")) {
    const headers = [...editInput.matchAll(/^\[([^\]\r\n]+)\]/gm)].map((match) => match[1].trim());
    if (headers.length > 0) {
      return headers
        .map((header) => header.replace(/#.*$/, ""))
        .filter((path) => path.length > 0);
    }
  }

  return readPathListField(input, ["path", "file_path", "filepath"]);
}

function getModifiedFilepaths(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  if (!isFileWritingToolName(toolName)) return [];
  switch (toolName) {
    case "edit":
      return getModifiedFilepathsFromEditInput(input);
    case "write":
      return readPathListField(input, ["path", "file_path", "filepath"]);
    case "multiedit":
      return readPathListField(input, ["edits", "files", "patches"]);
    case "read":
      return readPathListField(input, ["path", "file_path", "filepath"]);
  }
}

function getSidecarFingerprint(absolutePath: string): string {
  try {
    return getMurmurSidecarFingerprint(absolutePath);
  } catch {
    return "absent";
  }
}

export default function murmurExtension(pi: ExtensionAPI): void {
  const deliveredSidecarFingerprints = new Map<string, string>();

  pi.on("before_agent_start", async (event) => {
    const cwd = event.systemPromptOptions?.cwd || process.cwd();
    const result = scanMurmurFiles(cwd);
    const annotatedFiles = result.files.filter((file) => file.status === "annotated");
    if (annotatedFiles.length === 0) return;

    for (const file of annotatedFiles) {
      deliveredSidecarFingerprints.set(
        file.absolutePath,
        getSidecarFingerprint(file.absolutePath),
      );
    }

    const block = [
      "Murmurs — user-pinned line constraints in this project. Honor these when editing the named files:",
      formatMurmurBatch({ ...result, files: annotatedFiles }),
    ].join("\n");
    return {
      systemPrompt: [event.systemPrompt, block].filter(Boolean).join("\n\n"),
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const filepaths = getModifiedFilepaths(event.toolName, event.input as Record<string, unknown>);
    if (filepaths.length === 0) return;

    const cwd = ctx.cwd || process.cwd();
    const result = readMurmurFiles(filepaths, cwd);
    const freshFiles = result.files.filter((file) => {
      if (file.status !== "annotated") return false;
      return deliveredSidecarFingerprints.get(file.absolutePath) !== getSidecarFingerprint(file.absolutePath);
    });

    if (freshFiles.length === 0) return;
    return { additionalContext: formatMurmurBatch({ ...result, files: freshFiles }) };
  });

  // Per-file lookup — fallback for agents that want to inspect a specific file.
  pi.registerTool({
    name: "read_murmur",
    label: "Read Murmurs",
    description:
      "Read user-pinned line constraints for a single file. Prefer read_murmurs for batch lookups; this tool is kept for one-file callers and remains backwards compatible.",
    parameters: Type.Object({
      filepath: Type.String({
        description: "Absolute or relative path of the file you intend to modify",
      }),
    }),
    async execute(_toolCallId, params) {
      const [result] = readMurmurFiles([params.filepath]).files;
      const fileResult =
        result ?? {
          path: params.filepath,
          absolutePath: "",
          status: "clear" as const,
          murmurs: [],
        };
      const lines: string[] = [`Murmurs for ${fileResult.path} [${fileResult.status}]`];
      let detailsMurmurs: typeof fileResult.murmurs = [];
      switch (fileResult.status) {
        case "annotated":
          lines.push(
            formatMurmurBatch({
              root: fileResult.absolutePath,
              files: [fileResult],
              annotatedFileCount: 1,
              murmurCount: fileResult.murmurs.length,
            }),
          );
          detailsMurmurs = fileResult.murmurs;
          break;
        case "clear":
          lines.push("Clear to edit.");
          break;
        case "invalid_sidecar":
          lines.push(
            `Sidecar is invalid JSON${fileResult.error ? `: ${fileResult.error}` : ""}.`,
          );
          break;
        case "missing_source":
          lines.push(
            `Source file does not exist${fileResult.error ? `: ${fileResult.error}` : ""}.`,
          );
          break;
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { ok: true, status: fileResult.status, murmurs: detailsMurmurs },
      };
    },
  });

  pi.registerTool({
    name: "read_murmurs",
    label: "Read Murmurs (Batch)",
    description:
      "Read user-pinned line constraints for one or more files. Returns per-file status (annotated | clear | invalid_sidecar | missing_source) and murmurs in a single call. Use this in preference to multiple read_murmur calls.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), {
        description: "Absolute or relative file paths to inspect (duplicates deduped)",
      }),
    }),
    async execute(_toolCallId, params) {
      const result = readMurmurFiles(params.paths);
      return {
        content: [{ type: "text" as const, text: formatMurmurBatch(result) }],
        details: {
          ok: true,
          root: result.root,
          files: result.files,
          annotatedFileCount: result.annotatedFileCount,
          murmurCount: result.murmurCount,
        },
      };
    },
  });

  pi.registerTool({
    name: "scan_murmurs",
    label: "Scan Murmurs",
    description:
      "Scan a project directory for every murmur sidecar. Use this to refresh the project murmur index when sidecars change outside the agent's reach.",
    parameters: Type.Object({
      dir: Type.Optional(
        Type.String({ description: "Root directory to scan (defaults to cwd)" }),
      ),
      maxDepth: Type.Optional(
        Type.Integer({ description: "Max directory depth (default: unbounded)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = scanMurmurFiles(params.dir || process.cwd(), {
        ...(params.maxDepth !== undefined ? { maxDepth: params.maxDepth } : {}),
      });
      return {
        content: [{ type: "text" as const, text: formatMurmurBatch(result) }],
        details: {
          ok: true,
          root: result.root,
          files: result.files,
          annotatedFileCount: result.annotatedFileCount,
          murmurCount: result.murmurCount,
        },
      };
    },
  });

  // Add a murmur to a file's sidecar — the agent write API.
  pi.registerTool({
    name: "add_murmur",
    label: "Add Murmur",
    description:
      "Add a line annotation (murmur) to a file's sidecar. Generates UUID, timestamp, and anchor automatically. The Neovim file watcher re-renders on change — no RPC needed.",
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

      let murmurs: Murmur[] = [];
      try {
        const raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
        if (isMurmurArray(raw)) murmurs = raw;
      } catch {
        // no existing sidecar or corrupt JSON — start fresh
      }

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
      deliveredSidecarFingerprints.set(abs, getSidecarFingerprint(abs));

      return {
        content: [{ type: "text" as const, text: `Added murmur at ${params.filepath}:${params.line} [${params.author}] ${params.message}` }],
        details: { ok: true },
      };
    },
  });

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
      deliveredSidecarFingerprints.delete(abs);

      return {
        content: [{ type: "text" as const, text: count > 0 ? `Deleted ${count} murmur(s) from ${params.filepath}` : `No murmurs found for ${params.filepath}` }],
        details: { ok: true, count },
      };
    },
  });

  pi.registerTool({
    name: "delete_all_murmurs",
    label: "Delete All Murmurs",
    description:
      "Delete all murmur sidecar files in the project. Returns the total count of files removed.",
    parameters: Type.Object({
      dir: Type.Optional(
        Type.String({ description: "Root directory to scan (defaults to cwd)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const dir = params.dir || process.cwd();
      const result = scanMurmurFiles(dir);
      let count = 0;
      for (const file of result.files) {
        try {
          fs.unlinkSync(file.absolutePath + SIDECAR_SUFFIX);
          count += 1;
        } catch {
          // ignore individual failures
        }
      }
      deliveredSidecarFingerprints.clear();

      return {
        content: [{ type: "text" as const, text: `Deleted ${count} sidecar file(s) under ${dir}` }],
        details: { ok: true, count },
      };
    },
  });

  pi.registerCommand("murmur-scan", {
    description: "Scan the project for .murmur.json sidecars and report the count",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const result = scanMurmurFiles(cwd);
      const annotated = result.files.filter((file) => file.status === "annotated").length;
      ctx.ui.notify(
        annotated > 0
          ? `Found ${result.files.length} murmur sidecar(s) (${annotated} annotated)`
          : `No murmur sidecars found`,
        "info",
      );
    },
  });
}
