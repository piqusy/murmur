import { tool } from "@opencode-ai/plugin"
import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { isMurmurArray, SIDECAR_SUFFIX, type Murmur } from "../../shared/murmur-core.ts"

function resolveSidecar(filepath: string, root: string): string {
  return path.resolve(root, filepath) + SIDECAR_SUFFIX
}

export default tool({
  description:
    "Add a line annotation (murmur) to a file's sidecar. Generates UUID, timestamp, and anchor automatically. The Neovim file watcher re-renders on change — no RPC needed.",
  args: {
    filepath: tool.schema.string().describe("Absolute or relative path of the file to annotate"),
    line: tool.schema.number().describe("1-indexed line number to annotate"),
    author: tool.schema.string().describe('Author name (e.g. "Claude"). Anything other than "User" gets agent styling.'),
    message: tool.schema.string().describe("Annotation text — no length limit"),
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.filepath)
      ? args.filepath
      : path.resolve(context.directory || context.worktree || process.cwd(), args.filepath)
    const sidecar = abs + SIDECAR_SUFFIX

    let anchor = ""
    try {
      const lines = fs.readFileSync(abs, "utf-8").split("\n")
      anchor = (lines[args.line - 1] || "").trim()
    } catch {
      // anchor stays empty when source is unreadable
    }

    let murmurs: Murmur[] = []
    try {
      const raw = JSON.parse(fs.readFileSync(sidecar, "utf-8"))
      if (isMurmurArray(raw)) murmurs = raw
    } catch {
      // start fresh
    }

    murmurs.push({
      id: randomUUID(),
      line: args.line,
      anchor,
      author: args.author,
      message: args.message,
      created_at: new Date().toISOString(),
      orphaned: false,
    })
    murmurs.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))

    const tmp = sidecar + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(murmurs, null, 2))
    fs.renameSync(tmp, sidecar)

    return `Added murmur at ${args.filepath}:${args.line} [${args.author}] ${args.message}`
  },
})
