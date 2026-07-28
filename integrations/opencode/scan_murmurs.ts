import { tool } from "@opencode-ai/plugin"
import { formatMurmurBatch, scanMurmurFiles } from "../../shared/murmur-core.ts"

export default tool({
  description:
    "Scan a project directory for every murmur sidecar. Use this to refresh the project murmur index when sidecars change outside the agent's reach.",
  args: {
    dir: tool.schema
      .string()
      .optional()
      .describe("Root directory to scan (defaults to project directory)"),
    maxDepth: tool.schema
      .number()
      .optional()
      .describe("Max directory depth (default: unbounded)"),
  },
  async execute(args, context) {
    const root = args.dir || context.directory || context.worktree || process.cwd()
    const result = scanMurmurFiles(root, {
      ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    })
    return formatMurmurBatch(result)
  },
})
