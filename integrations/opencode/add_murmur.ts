import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
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
  orphaned?: boolean
}

function isMurmurArray(value: unknown): value is Murmur[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (item): item is Murmur => item !== null && typeof item === "object",
  )
}

export default tool({
  description:
    "Add a line annotation (murmur) to a file's sidecar. Generates UUID, timestamp, and line anchor automatically. The Neovim file watcher re-renders on change — no RPC needed.",
  args: {
    filepath: tool.schema
      .string()
      .describe("Absolute or relative path of the file to annotate"),
    line: tool.schema
      .number()
      .describe("1-indexed line number to annotate"),
    author: tool.schema
      .string()
      .describe('Author name (e.g. "Claude", "OpenCode"). Anything other than "User" gets agent styling.'),
    message: tool.schema
      .string()
      .describe("Annotation text — no length limit"),
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.filepath)
      ? args.filepath
      : path.resolve(context.directory || context.worktree || process.cwd(), args.filepath)
    const sidecar = abs + SIDECAR_SUFFIX

    // Read source file for anchor (trimmed text of the target line)
    let anchor = ""
    try {
      const content = fs.readFileSync(abs, "utf-8")
      const lines = content.split("\n")
      anchor = (lines[args.line - 1] || "").trim()
    } catch {
      // file might not be readable; anchor stays empty
    }

    const id = randomUUID()
    const ts = new Date().toISOString()

    // Read existing murmurs (read-before-write discipline)
    let murmurs: Murmur[] = []
    try {
      const raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"))
      if (isMurmurArray(raw)) murmurs = raw
    } catch {
      // no existing sidecar or corrupt JSON — start fresh
    }

    // Append, sort by line, write atomically
    murmurs.push({
      id,
      line: args.line,
      anchor,
      author: args.author,
      message: args.message,
      created_at: ts,
      orphaned: false,
    })
    murmurs.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))

    const tmp = sidecar + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(murmurs, null, 2))
    fs.renameSync(tmp, sidecar)

    return `Added murmur at ${args.filepath}:${args.line} [${args.author}] ${args.message}`
  },
})
