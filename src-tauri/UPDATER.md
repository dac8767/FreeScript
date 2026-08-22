# The updater's two configs, and why they are two

`tauri.conf.json` carries what the RUNNING APP needs: the endpoint it polls and
the public key it verifies downloads against. Both must ship inside every build.

`tauri.release.conf.json` carries what only a RELEASE BUILD needs:

```json
{ "bundle": { "createUpdaterArtifacts": true } }
```

It is a separate file rather than one more line in the main config because
`createUpdaterArtifacts` makes `tauri build` **sign** the bundle it produces,
and signing needs `TAURI_SIGNING_PRIVATE_KEY` in the environment. Turned on
unconditionally, Derek's own

```bash
npm run desktop:build
```

— a plain local unsigned `.app`, used to test file associations — would stop
working on a machine that has no private key, which is every machine except the
release runner. The overlay is applied only where the key is:

```bash
npm run tauri build -- --config src-tauri/tauri.release.conf.json
```

## Generating the key (once, on Derek's Mac)

```bash
cd /Users/dcarl/ScriptCraft
npm run tauri signer generate -- -w ~/.tauri/scriptcraft.key
```

That writes two files. Then:

- **`~/.tauri/scriptcraft.key.pub`** — paste its contents into
  `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`. It is public; it
  belongs in the repo. `check-updater-config` fails the suite until it is there.
- **`~/.tauri/scriptcraft.key`** — the private half. It never goes in the repo.
  Put it in GitHub → Settings → Secrets → Actions as
  `TAURI_SIGNING_PRIVATE_KEY`, plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the
  generator asked for a passphrase. Keep a copy somewhere safe: **losing it
  means no existing install can ever accept another update**, because they all
  verify against the public key baked into the build they are running.

This is Tauri's own signing and has nothing to do with Apple's. It answers
"is this download really the one ScriptCraft published"; Apple's Developer ID
answers "will macOS open this app at all". They are needed for different
reasons and neither substitutes for the other.
