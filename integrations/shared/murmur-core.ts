// Shared Murmur read core for OMP and OpenCode integrations.
// Pure functions; only depends on `node:fs`, `node:path`, and `node:crypto`.

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const SIDECAR_SUFFIX = ".murmur.json"

export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".venv",
  "vendor",
  "dist",
  "build",
  ".next",
  ".deps",
])

export interface Murmur {
  id?: string
  line?: number
  anchor?: string
  author?: string
  message?: string
  created_at?: string
  orphaned?: boolean
}

export type MurmurReadStatus =
  | "annotated"
  | "clear"
  | "invalid_sidecar"
  | "missing_source"

export interface MurmurFileResult {
  path: string
  absolutePath: string
  sidecarPath?: string
  status: MurmurReadStatus
  murmurs: Murmur[]
  error?: string
}

export interface MurmurBatchResult {
  root: string
  files: MurmurFileResult[]
  ignoredDirectories?: ReadonlySet<string>
  // Default depth is unbounded: rely on the ignored-directory list (.git,
  // node_modules, dist, .next, vendor, etc.) plus the caller's own .gitignore
  // choices. Call sites that want the legacy v0.3.0 cap can pass
  // `{ maxDepth: 6 }` explicitly.
  maxDepth?: number
}

export function isMurmurArray(value: unknown): value is Murmur[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        (item.line === undefined || typeof item.line === "number") &&
        (item.anchor === undefined || typeof item.anchor === "string") &&
        (item.author === undefined || typeof item.author === "string") &&
        (item.message === undefined || typeof item.message === "string"),
    )
  )
}

export function resolveMurmurSourcePath(filepath: string, root = process.cwd()): string {
  return path.resolve(root, filepath)
}

export function getMurmurSidecarFingerprint(
  filepath: string,
  root = process.cwd(),
): string {
  const sidecarPath = resolveMurmurSourcePath(filepath, root) + SIDECAR_SUFFIX
  try {
    return createHash("sha256").update(fs.readFileSync(sidecarPath)).digest("hex")
  } catch {
    return "absent"
  }
}

export function readMurmurFile(filepath: string, root = process.cwd()): MurmurFileResult {
  const absolutePath = resolveMurmurSourcePath(filepath, root)
  const sidecarPath = absolutePath + SIDECAR_SUFFIX
  const sourceExists = fs.existsSync(absolutePath)

  if (!fs.existsSync(sidecarPath)) {
    return {
      path: filepath,
      absolutePath,
      status: sourceExists ? "clear" : "missing_source",
      murmurs: [],
      ...(sourceExists ? {} : { error: "source file does not exist" }),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"))
  } catch (error) {
    return {
      path: filepath,
      absolutePath,
      sidecarPath,
      status: "invalid_sidecar",
      murmurs: [],
      error: error instanceof Error ? error.message : "invalid JSON",
    }
  }

  if (!isMurmurArray(parsed)) {
    return {
      path: filepath,
      absolutePath,
      sidecarPath,
      status: "invalid_sidecar",
      murmurs: [],
      error: "sidecar must contain an array of murmur objects",
    }
  }

  if (!sourceExists) {
    return {
      path: filepath,
      absolutePath,
      sidecarPath,
      status: "missing_source",
      murmurs: parsed,
      error: "source file does not exist",
    }
  }

  return {
    path: filepath,
    absolutePath,
    sidecarPath,
    status: parsed.length > 0 ? "annotated" : "clear",
    murmurs: parsed,
  }
}

export function readMurmurFiles(filepaths: string[], root = process.cwd()): MurmurBatchResult {
  const uniquePaths = new Map<string, string>()
  for (const filepath of filepaths) {
    if (filepath.trim().length === 0) continue
    const absolutePath = resolveMurmurSourcePath(filepath, root)
    if (!uniquePaths.has(absolutePath)) uniquePaths.set(absolutePath, filepath)
  }
  const files = [...uniquePaths.values()].map((filepath) => readMurmurFile(filepath, root))

  return {
    root,
    files,
    annotatedFileCount: files.filter((file) => file.status === "annotated").length,
    murmurCount: files.reduce((count, file) => count + file.murmurs.length, 0),
  }
}

export function scanMurmurFiles(
  root = process.cwd(),
  options: ScanMurmurOptions = {},
): MurmurBatchResult {
  const absoluteRoot = path.resolve(root)
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY
  const ignoredDirectories = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES
  const sourcePaths: string[] = []

  function walk(directory: string, depth: number): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && depth < maxDepth) {
          walk(path.join(directory, entry.name), depth + 1)
        }
        continue
      }

      if (!entry.isFile() || !entry.name.endsWith(SIDECAR_SUFFIX)) {
        continue
      }

      const sidecarPath = path.join(directory, entry.name)
      const sourcePath = sidecarPath.slice(0, -SIDECAR_SUFFIX.length)
      sourcePaths.push(path.relative(absoluteRoot, sourcePath) || sourcePath)
    }
  }

  walk(absoluteRoot, 0)
  return readMurmurFiles(sourcePaths.sort(), absoluteRoot)
}

function formatMurmur(murmur: Murmur): string {
  const orphaned = murmur.orphaned === true ? " [orphaned]" : ""
  return `  L${murmur.line ?? "?"} [${murmur.author ?? "User"}] ${murmur.message ?? ""}${orphaned} (anchored: "${(murmur.anchor ?? "").trim()}")`
}

export function formatMurmurBatch(result: MurmurBatchResult): string {
  if (result.files.length === 0) {
    return "No files checked."
  }

  const lines = [
    `Murmurs: ${result.murmurCount} annotation(s) across ${result.files.length} checked file(s).`,
  ]
  const clearPaths: string[] = []

  for (const file of result.files) {
    if (file.status === "clear") {
      clearPaths.push(file.path)
      continue
    }

    lines.push("", `${file.path} [${file.status}]`)
    if (file.error) lines.push(`  ${file.error}`)
    if (file.murmurs.length > 0) {
      lines.push(...file.murmurs.map(formatMurmur))
    }
  }

  if (clearPaths.length > 0) {
    lines.push("", `Clear: ${clearPaths.join(", ")}`)
  }

  return lines.join("\n")
}
