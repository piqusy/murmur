// Exercise the installed OMP runtime, not a mock of its hook return contract.
// Requires a source-distributed OMP installation on PATH, or MURMUR_OMP_ROOT.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const binary = Bun.which("omp");
const root = process.env.MURMUR_OMP_ROOT ?? (binary ? dirname(dirname(realpathSync(binary))) : undefined);
if (!root) throw new Error("Install OMP or set MURMUR_OMP_ROOT to its coding-agent package directory.");
const host = (file: string) => import(pathToFileURL(join(root, "src", file)).href);
const { loadExtensions } = await host("extensibility/extensions/loader.ts");
const { ExtensionRunner } = await host("extensibility/extensions/runner.ts");
const { ExtensionToolWrapper } = await host("extensibility/extensions/wrapper.ts");
const { SessionManager } = await host("session/session-manager.ts");

const cwd = process.cwd();
const dir = realpathSync(mkdtempSync(join(tmpdir(), "murmur-midturn-")));
try {
  process.chdir(dir);
  const file = join(dir, "example.txt");
  writeFileSync(file, "original");
  const { extensions, runtime, errors } = await loadExtensions(
    [resolve(import.meta.dir, "../integrations/omp/index.ts")], dir,
  );
  assert.deepEqual(errors, []);
  const runner = new ExtensionRunner(extensions, runtime, dir, SessionManager.inMemory(dir), undefined);
  runner.onError((error: { error: string }) => { throw new Error(error.error); });
  await runner.emitBeforeAgentStart("Edit file", undefined, ["Base prompt"]);
  const note = (message: string) => writeFileSync(file + ".murmur.json", JSON.stringify([
    { line: 1, anchor: "original", author: "User", message },
  ]));
  const wrapped = new ExtensionToolWrapper({
    name: "write",
    label: "Write",
    description: "Write the temporary fixture",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
    async execute(_id: string, params: { path: string; content: string }) {
      writeFileSync(params.path, params.content);
      return { content: [{ type: "text", text: "Written" }], details: {} };
    },
  }, runner);
  const write = (id: string, content: string) => wrapped.execute(id, { path: file, content });

  // An annotation created after startup must be delivered before any mutation.
  note("Keep the original until reviewed");
  await assert.rejects(write("first", "changed"), /Keep the original until reviewed/);
  await assert.rejects(write("same-batch", "bypassed"), /Keep the original until reviewed/);
  assert.equal(readFileSync(file, "utf8"), "original");
  await runner.emitContext([]);
  await write("retry", "changed");
  assert.equal(readFileSync(file, "utf8"), "changed");

  // A revised note requires another review, but must not create an endless block.
  note("Second revision needs review");
  await assert.rejects(write("revised", "revised"), /Second revision needs review/);
  assert.equal(readFileSync(file, "utf8"), "changed");
  await runner.emitContext([]);
  await write("revised-retry", "revised");
  assert.equal(readFileSync(file, "utf8"), "revised");

  // Startup delivery already shows the note; the next operation need not stop.
  note("Delivered at startup");
  const injected = await runner.emitBeforeAgentStart("Continue", undefined, ["Base prompt"]);
  assert(injected?.systemPrompt?.some((part: string) => part.includes("Delivered at startup")));
  await write("startup-delivered", "allowed");
  assert.equal(readFileSync(file, "utf8"), "allowed");

  // Adding an agent note must not acknowledge an unseen, merged user note.
  note("Unseen user constraint");
  await extensions[0].tools.get("add_murmur").definition.execute("add", {
    filepath: file, line: 1, author: "Agent", message: "Agent annotation",
  });
  await runner.emitContext([]);
  await assert.rejects(write("after-add", "lost constraint"), /Unseen user constraint/);
  await assert.rejects(write("after-add-same-batch", "bypassed"), /Unseen user constraint/);
  assert.equal(readFileSync(file, "utf8"), "allowed");
  await runner.emitContext([]);
  await write("after-add-reviewed", "reviewed merged notes");
  assert.equal(readFileSync(file, "utf8"), "reviewed merged notes");

  rmSync(file + ".murmur.json");
  await write("clear", "no annotation");
  assert.equal(readFileSync(file, "utf8"), "no annotation");
  console.log("PASS: OMP blocks every pre-context write, permits post-context retries, and handles revised/startup/clear notes.");
} finally {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
}
