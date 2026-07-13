import { tool } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"

const SIDECAR_SUFFIX = ".murmur.json"

export default tool({
  description:
    "Delete all murmurs in a single file by removing its sidecar. Returns the count of murmurs removed.",
  args: {
    filepath: tool.schema
      .string()
      .describe("Absolute or relative path of the file whose murmurs to delete"),
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.filepath)
      ? args.filepath
      : path.resolve(context.directory || context.worktree || process.cwd(), args.filepath)
    const sidecar = abs + SIDECAR_SUFFIX

    let count = 0
    try {
      const raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"))
      if (Array.isArray(raw)) count = raw.length
    } catch {
      // no sidecar or corrupt JSON — count stays 0
    }

    try {
      fs.unlinkSync(sidecar)
    } catch {
      // already gone
    }

    return count > 0
      ? `Deleted ${count} murmur(s) from ${args.filepath}`
      : `No murmurs found for ${args.filepath}`
  },
})
