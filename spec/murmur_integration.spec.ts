// Murmur integration regression tests. Most of these run outside Murmur's
// plenary harness and only verify the integration source files exist and
// ship the expected tool surfaces — see the "scanMurmurFiles / formatMurmurBatch"
// block below for actual runtime behavior coverage.

import { describe, it, expect, afterEach } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { scanMurmurFiles, formatMurmurBatch } from "../integrations/shared/murmur-core.ts"

const REPO_ROOT = resolve(import.meta.dir, "..")
const OMP_INDEX = resolve(REPO_ROOT, "integrations/omp/index.ts")
const OPENCODE_DIR = resolve(REPO_ROOT, "integrations/opencode")
const SHARED_CORE = resolve(REPO_ROOT, "integrations/shared/murmur-core.ts")
const REQUIRED_OMP_TOOLS = [
  "read_murmur",
  "read_murmurs",
  "scan_murmurs",
  "add_murmur",
  "delete_file_murmurs",
  "delete_all_murmurs",
] as const

describe("Murmur integration surface", () => {
  it("ships the shared read core", () => {
    expect(existsSync(SHARED_CORE)).toBe(true)
    const source = readFileSync(SHARED_CORE, "utf-8")
    expect(source).toContain("export function readMurmurFile")
    expect(source).toContain("export function readMurmurFiles")
    expect(source).toContain("export function scanMurmurFiles")
    expect(source).toContain("export function getMurmurSidecarFingerprint")
  })

  it("registers every documented read and write tool in OMP", () => {
    const source = readFileSync(OMP_INDEX, "utf-8")
    for (const toolName of REQUIRED_OMP_TOOLS) {
      expect(source).toContain(`name: "${toolName}"`)
    }
    expect(source).toContain('pi.on("tool_call"')
  })

  it("OMP preflight inspects hashline multi-section inputs", () => {
    const source = readFileSync(OMP_INDEX, "utf-8")
    expect(source).toContain("getModifiedFilepathsFromEditInput")
    expect(source).toMatch(/\[PATH#TAG\]/)
  })

  it("OpenCode ships batch and scan tools alongside the legacy read_murmur", () => {
    for (const file of [
      "read_murmur.ts",
      "scan_murmurs.ts",
      "add_murmur.ts",
      "delete_file_murmurs.ts",
      "delete_all_murmurs.ts",
    ]) {
      expect(existsSync(resolve(OPENCODE_DIR, file))).toBe(true)
    }
  })
})

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
