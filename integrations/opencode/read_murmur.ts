import { tool } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"

const SIDECAR_SUFFIX = ".murmur.json"

interface Murmur {
  id?: string
  line?: number
  anchor?: string
  author?: string
  message?: string
  created_at?: string
}

function isMurmurArray(value: unknown): value is Murmur[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (item): item is Murmur => item !== null && typeof item === "object",
  )
}

export default tool({
  description:
    "Read user-pinned line constraints (murmurs) for a file before editing it. Always call before modifying a file.",
  args: {
    filepath: tool.schema
      .string()
      .describe("Absolute or relative path of the file you intend to modify"),
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.filepath)
      ? args.filepath
      : path.resolve(context.directory || context.worktree || process.cwd(), args.filepath)

    const sidecar = abs + SIDECAR_SUFFIX

    if (!fs.existsSync(sidecar)) {
      return `No murmurs for ${args.filepath}. Clear to edit.`
    }

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"))
    } catch {
      return `No murmurs for ${args.filepath}. Clear to edit.`
    }

    if (!isMurmurArray(raw) || raw.length === 0) {
      return `No murmurs for ${args.filepath}. Clear to edit.`
    }

    const lines = raw
      .map(
        (m) =>
          `- L${m.line ?? "?"} [${m.author ?? "User"}] ${m.message ?? ""} (anchored: "${(m.anchor ?? "").trim()}")`,
      )
      .join("\n")

    return `Murmurs for ${args.filepath}:\n${lines}`
  },
})
