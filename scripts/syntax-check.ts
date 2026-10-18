// Syntax-only check for integration modules: transpiles each file without
// resolving imports, so peer dependencies (omp/opencode hosts) are not needed.
// Usage: bun scripts/syntax-check.ts <file> [<file> ...]
const files = Bun.argv.slice(2)
if (files.length === 0) {
  console.error("usage: bun scripts/syntax-check.ts <file> [<file> ...]")
  process.exit(2)
}

let failed = 0
for (const file of files) {
  try {
    const loader = file.endsWith(".ts") ? "ts" : "js"
    new Bun.Transpiler({ loader }).transformSync(await Bun.file(file).text())
  } catch (error) {
    failed++
    console.error(`::error file=${file}::syntax check failed`)
    console.error(error instanceof Error ? error.message : error)
  }
}
process.exit(failed > 255 ? 255 : failed)
