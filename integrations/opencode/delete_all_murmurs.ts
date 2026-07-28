import { tool } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import { formatMurmurBatch, scanMurmurFiles, SIDECAR_SUFFIX } from "../../shared/murmur-core.ts"

export default tool({
  description: "Delete all murmur sidecar files in the project. Returns the total count of files removed.",
  args: {
    dir: tool.schema.string().optional().describe("Root directory to scan (defaults to project directory)"),
  },
  async execute(args, context) {
    const root = args.dir || context.directory || context.worktree || process.cwd()
    const result = scanMurmurFiles(root)
    let count = 0
    for (const file of result.files) {
      try {
        fs.unlinkSync(file.absolutePath + SIDECAR_SUFFIX)
        count += 1
      } catch {
        // ignore individual failures
      }
    }
    return `Deleted ${count} sidecar file(s) under ${root}`
  },
})
