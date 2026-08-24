/* check-fs-scope — the v7.17 narrowing, guarded (Derek's audit item 3).
 *
 * The fs plugin's capability used to grant $HOME/** (plus $DOCUMENT, $DESKTOP,
 * $DOWNLOAD, /Volumes) for read, write, mkdir, remove and exists — because a
 * few features write to folders the USER picked, and Tauri v2's dialog plugin
 * does not extend the fs scope to a picked path. So the whole home directory
 * was opened to the webview to serve six call sites.
 *
 * Those sites now go through Rust commands, which bypass the plugin scope by
 * design, and the capability is $APPDATA only.
 *
 * NONE of that can be exercised here — there is no Tauri runtime in this
 * sandbox, the driver is a browser. What CAN be proven is every static
 * invariant the change depends on, and each of these has a failure mode that
 * would only otherwise appear on Derek's Mac, at save time:
 *
 *   1 the capability really is $APPDATA-only (the point of the change)
 *   2 nobody imports the fs plugin outside the AppData-only modules
 *   3 every fs call in those modules passes baseDir: BaseDirectory.AppData —
 *     one that forgets is a relative path resolved against the CWD, outside
 *     the scope, and it fails at runtime only
 *   4 every Rust command the frontend invokes exists AND is registered in
 *     generate_handler! — an unregistered command is a runtime-only "command
 *     not found", which is exactly how this would break silently
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'frontend/src');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ── 1: the capability ────────────────────────────────────────────── */
console.log('\n1. the fs capability');
const cap = JSON.parse(read('src-tauri/capabilities/default.json'));
const fsPerms = cap.permissions.filter((p) => typeof p === 'object' && /^fs:/.test(p.identifier));
ok('the fs permissions are still declared', fsPerms.length >= 6, String(fsPerms.length));
const strayPaths = fsPerms.flatMap((p) => (p.allow ?? [])
  .map((a) => a.path)
  .filter((path) => !/^\$APPDATA(\/\*{1,2})?$/.test(path))
  .map((path) => `${p.identifier}:${path}`));
ok('every fs permission is $APPDATA-only', strayPaths.length === 0, JSON.stringify(strayPaths));
ok('…and $HOME is gone from the whole capability',
  !JSON.stringify(cap).includes('$HOME'), '');

/* ── 2 + 3: who may touch the fs plugin, and how ──────────────────── */
console.log('\n2. the fs plugin\'s remaining callers');

/* The ONLY modules allowed to import it: the app's own store and its
   fallbacks, all of which live in $APPDATA, plus the print staging file. */
const ALLOWED = new Set([
  'services/local-storage.ts',
  'services/file-fallback-storage.ts',
  'services/file-fallback-recovery.ts',
  'utils/pdfExporter.ts',
]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
  }
})(SRC);

const importers = files
  .filter((f) => readFileSync(f, 'utf8').includes('@tauri-apps/plugin-fs'))
  .map((f) => f.slice(SRC.length + 1));
const unexpected = importers.filter((f) => !ALLOWED.has(f));
ok('only the AppData-only modules import the fs plugin', unexpected.length === 0, JSON.stringify(unexpected));
ok('…and all of them still do', ALLOWED.size === importers.filter((f) => ALLOWED.has(f)).length,
  JSON.stringify(importers));

/* The four sites this change rerouted, named so a revert is loud. */
for (const site of [
  'components/SaveAsDialog.tsx',
  'components/AssetManager.tsx',
  'services/saveLocations.ts',
  'utils/screenshot.ts',
]) {
  const text = readFileSync(join(SRC, site), 'utf8');
  ok(`${site} writes user-chosen paths through Rust`,
    !text.includes('@tauri-apps/plugin-fs') && /invoke[<(]/.test(text), '');
}

console.log('\n3. every fs call names its base directory');
/* A call without `baseDir` resolves relative to the process CWD — outside
   $APPDATA, so it fails the scope check at runtime and nowhere else. */
const FS_FNS = ['writeTextFile', 'writeFile', 'readTextFile', 'readFile', 'mkdir', 'remove', 'exists', 'readDir', 'rename', 'copyFile'];
/* Names are matched as BARE calls — `writeFile(` but never `el.remove(` —
   rather than by parsing the import. The first cut of this check read the
   import statement, and pdfExporter destructures the plugin out of a
   Promise.all array, so it matched nothing and the file passed with "0 fns":
   a vacuous assertion on the one caller most likely to drift. The counts are
   asserted below for the same reason. */
const CALL = (fn) => new RegExp(`(?<![.\\w])${fn}\\(`, 'g');
for (const rel of ALLOWED) {
  const text = readFileSync(join(SRC, rel), 'utf8');
  const names = FS_FNS.filter((n) => CALL(n).test(text));
  const bad = [];
  for (const fn of names) {
    for (const m of text.matchAll(CALL(fn))) {
      // balance parens from the call site to find its full argument list
      let depth = 0, i = m.index + m[0].length - 1, end = text.length - 1;
      for (; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      const args = text.slice(m.index, end + 1);
      if (!args.includes('BaseDirectory.AppData')) {
        bad.push(`${rel}: ${args.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
  }
  ok(`${rel} — every fs call is AppData-based (${names.length} fns)`,
    names.length > 0 && bad.length === 0,
    names.length === 0 ? 'found NO fs calls — the scan matched nothing' : JSON.stringify(bad));
}

/* ── 4: the Rust commands exist and are registered ────────────────── */
console.log('\n4. the Rust side actually answers');
const rust = read('src-tauri/src/lib.rs');
const handler = rust.slice(rust.indexOf('generate_handler!['));
const registered = new Set([...handler.slice(0, handler.indexOf(']')).matchAll(/([a-z_][a-z0-9_]*)\s*,/g)].map((m) => m[1]));

const invoked = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/invoke(?:Cmd)?(?:<[^>]*>)?\(\s*'([a-z_][a-z0-9_]*)'/g)) invoked.add(m[1]);
}
ok('the frontend invokes commands at all', invoked.size >= 5, String(invoked.size));
const missingFn = [...invoked].filter((c) => !new RegExp(`fn ${c}\\s*\\(`).test(rust));
const missingReg = [...invoked].filter((c) => new RegExp(`fn ${c}\\s*\\(`).test(rust) && !registered.has(c));
ok('every invoked command is defined in lib.rs', missingFn.length === 0, JSON.stringify(missingFn));
ok('…and registered in generate_handler!', missingReg.length === 0, JSON.stringify(missingReg));

for (const cmd of ['save_text_to_path', 'save_binary_to_path', 'read_binary_file', 'check_folder_writable']) {
  ok(`${cmd} is wired`, new RegExp(`fn ${cmd}\\s*\\(`).test(rust) && registered.has(cmd), '');
}
/* v7.87 (review D3): both writers go through atomic_write, which (a) creates
   missing parents — a chosen folder can be deleted between the pick and the
   save, and an auto-save writes into an "Auto Saves" subfolder absent on first
   use — and (b) writes a temp file then renames it over the target, so a failed
   save can no longer truncate the file to empty. */
const writers = rust.match(/fn save_(?:text|binary)_to_path[\s\S]*?\n\}/g) ?? [];
ok('both save_*_to_path commands go through atomic_write',
  writers.length === 2 && writers.every((w) => /atomic_write\(/.test(w)), String(writers.length));
const atomic = rust.match(/fn atomic_write[\s\S]*?\n\}/)?.[0] ?? '';
ok('atomic_write creates missing parents AND renames into place (no truncation)',
  atomic.includes('create_dir_all') && /rename\(/.test(atomic), '');
ok('check_folder_writable cleans up after itself',
  /fn check_folder_writable[\s\S]*?remove_file/.test(rust), '');

console.log(`\ncheck-fs-scope: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
