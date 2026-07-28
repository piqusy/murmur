import { tool } from "@opencode-ai/plugin"
import { formatMurmurBatch, readMurmurFile, readMurmurFiles, type MurmurFileResult } from "../../shared/murmur-core.ts"

function singleFileMessage(result: MurmurFileResult, filepath: string): string {
  if (result.status !== "annotated") {
    return `No murmurs for ${filepath}. Clear to edit.`
  }
  return `Murmurs for ${filepath}:\n${formatMurmurBatch({ root: result.absolutePath, files: [result], annotatedFileCount: 1, murmurCount: result.murmurs.length })}`
}

export default tool({
  description:
    "Read user-pinned line constraints (murmurs) for a file before editing it. Always call before modifying a file. Prefer read_murmurs for batch lookups.",
  args: {
    filepath: tool.schema.string().describe("Absolute or relative path of the file you intend to modify"),
  },
  async execute(args, context) {
    const root = context.directory || context.worktree || process.cwd()
    const result = readMurmurFile(args.filepath, root)
    return singleFileMessage(result, args.filepath)
  },
})

export const readMurmursTool = tool({
  description:
    "Read user-pinned line constraints (murmurs) for one or more files. Use this in preference to multiple read_murmur calls.",
  args: {
    paths: tool.schema.array(tool.schema.string()).describe("Absolute or relative file paths to inspect"),
  },
  async execute(args, context) {
    const root = context.directory || context.worktree || process.cwd()
    return formatMurmurBatch(readMurmurFiles(args.paths, root))
  },
})
