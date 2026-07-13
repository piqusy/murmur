import { tool } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"

const SIDECAR_SUFFIX = ".murmur.json"

const IGNORE_DIRS: Record<string, true> = {
  ".git": true,
  "node_modules": true,
  ".venv": true,
  "vendor": true,
  "dist": true,
  "build": true,
  ".next": true,
}

const MAX_DEPTH = 6

function globMurmurs(root: string): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(root, { recursive: true }) as string[]
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry !== "string") continue
    if (!entry.endsWith(SIDECAR_SUFFIX)) continue
    const segs = entry.split(path.sep)
    if (segs.length > MAX_DEPTH) continue
    if (segs.some((s) => IGNORE_DIRS[s])) continue
    out.push(path.join(root, entry))
  }
  return out
}

export default tool({
  description:
    "Delete all murmur sidecar files in the project. Returns the total count of files removed.",
  args: {
    dir: tool.schema
      .string()
      .optional()
      .describe("Root directory to scan (defaults to project directory)"),
  },
  async execute(args, context) {
    const root = args.dir || context.directory || context.worktree || process.cwd()
    const sidecars = globMurmurs(root)
    let count = 0
    for (const sc of sidecars) {
      try {
        fs.unlinkSync(sc)
        count++
      } catch {
        // ignore individual failures
      }
    }
    return `Deleted ${count} sidecar file(s) under ${root}`
  },
})
