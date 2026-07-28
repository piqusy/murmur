// Murmur integration regression tests. These run outside Murmur's plenary
// harness; they only verify the integration source files exist and ship the
// expected tool surfaces.

import { describe, it, expect } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

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
