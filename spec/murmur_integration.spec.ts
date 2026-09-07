// Shared-core behavior regressions. Installed OMP hook/wrapper coverage lives
// in scripts/murmur-omp-smoke.ts.

import { describe, it, expect, afterEach } from "bun:test"
import { readMurmurFile } from "../integrations/shared/murmur-core.ts"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanMurmurFiles, formatMurmurBatch } from "../integrations/shared/murmur-core.ts"


describe("scanMurmurFiles / formatMurmurBatch", () => {
  let fixtureDir: string | undefined

  afterEach(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  })

  it("formats a real annotated murmur without throwing (regression: formatMurmur used undefined `m` instead of `murmur`)", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(join(fixtureDir, "annotated.txt"), "annotated file\n")
    writeFileSync(
      join(fixtureDir, "annotated.txt.murmur.json"),
      JSON.stringify([
        { line: 1, anchor: "annotated file", author: "User", message: "needs review", orphaned: false },
      ]),
    )

    const result = scanMurmurFiles(fixtureDir)
    const output = formatMurmurBatch(result)

    expect(output).toContain("needs review")
    expect(output).toContain('(anchored: "annotated file")')
    expect(result.murmurCount).toBe(1)
    expect(result.annotatedFileCount).toBe(1)
  })

  it("formats a multiline murmur with its inclusive line range", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(join(fixtureDir, "selected.ts"), "first\nsecond\nthird\nfourth\n")
    writeFileSync(
      join(fixtureDir, "selected.ts.murmur.json"),
      JSON.stringify([
        {
          line: 2,
          end_line: 4,
          anchor: "second",
          end_anchor: "fourth",
          author: "User",
          message: "review this selection",
        },
      ]),
    )

    expect(formatMurmurBatch(scanMurmurFiles(fixtureDir))).toContain("L:2-4 [User] review this selection")
  })

  it("reports clear, invalid, and missing-source files with correct statuses and counts", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))

    writeFileSync(join(fixtureDir, "clear.txt"), "hello\n")
    writeFileSync(join(fixtureDir, "clear.txt.murmur.json"), "[]")

    writeFileSync(join(fixtureDir, "invalid.txt"), "x\n")
    writeFileSync(join(fixtureDir, "invalid.txt.murmur.json"), "{not valid json")

    writeFileSync(
      join(fixtureDir, "missing-source.txt.murmur.json"),
      JSON.stringify([{ line: 1, anchor: "gone", author: "User", message: "source deleted" }]),
    )

    const result = scanMurmurFiles(fixtureDir)
    const output = formatMurmurBatch(result)

    expect(result.files.find((f) => f.path === "clear.txt")?.status).toBe("clear")
    expect(result.files.find((f) => f.path === "invalid.txt")?.status).toBe("invalid_sidecar")
    expect(result.files.find((f) => f.path === "missing-source.txt")?.status).toBe("missing_source")
    // missing_source still carries its parsed murmurs — they count and print.
    expect(result.murmurCount).toBe(1)
    expect(output).toContain("source deleted")
    expect(output).toContain("Clear: clear.txt")
  })

  it("returns 'No files checked.' when nothing is annotated", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    mkdirSync(join(fixtureDir, "empty-subdir"))

    const result = scanMurmurFiles(fixtureDir)
    expect(formatMurmurBatch(result)).toBe("No files checked.")
  })
})

describe("readMurmurFile per-file status", () => {
  let fixtureDir: string | undefined

  afterEach(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  })

  it("returns 'annotated' for a file with a non-empty sidecar", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(join(fixtureDir, "src.ts"), "export const x = 1;\n")
    writeFileSync(
      join(fixtureDir, "src.ts.murmur.json"),
      JSON.stringify([
        { line: 1, anchor: "export const x = 1;", author: "User", message: "needs review" },
      ]),
    )

    const result = readMurmurFile("src.ts", fixtureDir)
    expect(result.status).toBe("annotated")
    expect(result.murmurs).toHaveLength(1)
  })

  it("returns 'clear' for a file with no sidecar", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(join(fixtureDir, "empty.ts"), "// empty\n")

    const result = readMurmurFile("empty.ts", fixtureDir)
    expect(result.status).toBe("clear")
    expect(result.murmurs).toHaveLength(0)
  })

  it("returns 'invalid_sidecar' when the sidecar is malformed JSON", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(join(fixtureDir, "broken.ts"), "// broken\n")
    writeFileSync(join(fixtureDir, "broken.ts.murmur.json"), "{not valid json")

    const result = readMurmurFile("broken.ts", fixtureDir)
    expect(result.status).toBe("invalid_sidecar")
    expect(result.error).toBeDefined()
  })

  it("returns 'missing_source' when the source file does not exist", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(
      join(fixtureDir, "ghost.ts.murmur.json"),
      JSON.stringify([{ line: 1, anchor: "ghost", author: "User", message: "stale" }]),
    )

    const result = readMurmurFile("ghost.ts", fixtureDir)
    expect(result.status).toBe("missing_source")
    expect(result.murmurs).toHaveLength(1)
  })

  it("returns 'invalid_sidecar' when the sidecar is not an array", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "murmur-spec-"))
    writeFileSync(join(fixtureDir, "shape.ts"), "// shape\n")
    writeFileSync(join(fixtureDir, "shape.ts.murmur.json"), JSON.stringify({ not: "an array" }))

    const result = readMurmurFile("shape.ts", fixtureDir)
    expect(result.status).toBe("invalid_sidecar")
    expect(result.error).toContain("array of murmur objects")
  })
})


