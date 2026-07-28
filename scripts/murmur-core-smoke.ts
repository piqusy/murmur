// Standalone smoke for integrations/shared/murmur-core.ts
// Run with: bun scripts/murmur-core-smoke.ts
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  readMurmurFile,
  readMurmurFiles,
  scanMurmurFiles,
  getMurmurSidecarFingerprint,
} from "../integrations/shared/murmur-core"

const tmp = mkdtempSync(join(tmpdir(), "murmur-smoke-"))
try {
  writeFileSync(join(tmp, "src.ts"), "export const x = 1;\n")
  writeFileSync(
    join(tmp, "src.ts.murmur.json"),
    JSON.stringify([{ line: 1, anchor: "export const x = 1;", author: "User", message: "keep" }]),
  )
  writeFileSync(join(tmp, "broken.ts.murmur.json"), '{"line": 1, "anchor": "broken"')
  writeFileSync(join(tmp, "empty.murmur.json"), "[]")

  const empty = readMurmurFile("empty.murmur.json", tmp)
  const batch = readMurmurFiles(["src.ts", "missing.ts", "broken.ts"], tmp)
  const scan = scanMurmurFiles(tmp)
  const fingerprint = getMurmurSidecarFingerprint("src.ts", tmp)

  console.log(
    JSON.stringify(
      {
        emptyStatus: empty.status,
        batch: batch.files.map((file) => ({ path: file.path, status: file.status })),
        annotatedFileCount: scan.annotatedFileCount,
        fingerprint,
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
