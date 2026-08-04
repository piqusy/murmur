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
    end_line: tool.schema.number().optional().describe("Optional inclusive 1-indexed final line for a multiline murmur"),
    message: tool.schema.string().describe("Annotation text — no length limit"),
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.filepath)
      ? args.filepath
      : path.resolve(context.directory || context.worktree || process.cwd(), args.filepath)
    const sidecar = abs + SIDECAR_SUFFIX

    let anchor = ""
    let endAnchor = ""
    let sourceLines: string[] = []
    try {
      sourceLines = fs.readFileSync(abs, "utf-8").split("\n")
      anchor = (sourceLines[args.line - 1] || "").trim()
    } catch {
      // source may be unreadable; anchors stay empty
    }
    const endLine = args.end_line && args.end_line > args.line && args.end_line <= sourceLines.length
      ? args.end_line
      : undefined
    if (endLine) endAnchor = (sourceLines[endLine - 1] || "").trim()

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
      ...(endLine ? { end_line: endLine, end_anchor: endAnchor } : {}),
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

    return `Added murmur at ${args.filepath}:${endLine ? `L:${args.line}-${endLine}` : args.line} [${args.author}] ${args.message}`
  },
})
