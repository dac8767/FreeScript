# In-app updating — how it works, and what still has to be set up

**Status (v7.78): the app can install its own updates. Nothing has been
published yet, so nothing does.** Three things have to exist before the first
update can reach anybody, and all three are Derek's to create. They are listed
at the bottom.

---

## What the app does today

Two checks, deliberately different in manner (unchanged since v7.62):

- **On launch**, four seconds in, silently. If there is no newer version, or
  the network is down, or the manifest is missing — it says nothing. A writer
  opening a script on a train has not asked about updates.
- **Help ▸ Check for Updates…** always answers, including "you're up to date"
  and including the error. A question that gets silence back cannot be told
  from a broken feature.

When there IS a newer version, a banner appears with up to two actions:

| | when |
|---|---|
| **Install and Restart** | only when the published manifest carries an installer for *this exact machine* |
| **Download** | **always** — it is the way out of every failure the install path can hit |

The install button is gated on the manifest, not on "are we in the desktop
app". Offering to install a build the release does not carry for this
architecture would download something the machine cannot run. The machine's
identity comes from Rust (`updater_target` in `src-tauri/src/lib.rs`) because
WebKit reports "Intel Mac OS X" on Apple Silicon — asking the webview gets a
confident wrong answer rather than no answer.

## One manifest, two readers

`latest.json` is a single file that both the banner and Tauri's own updater
understand. Tauri reads `version`, `notes`, `pub_date` and `platforms`;
`services/updateCheck.ts` reads `version`, `url`, `notes` and `date`. Each
ignores the other's fields — so there is still exactly one version number in
exactly one place, which is the whole subject of v7.62 and v7.63.

```json
{
  "version": "7.78.0",
  "url": "https://github.com/dac8767/ScriptCraft-releases/releases/tag/v7.78",
  "notes": "One short line, shown beside the version.",
  "date": "2026-08-22",
  "pub_date": "2026-08-22T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "…", "url": "https://…/ScriptCraft.app.tar.gz" }
  }
}
```

`version` is **full semver** — `7.78.0`, not `7.78`. Tauri parses it with the
`semver` crate, which rejects two components; that is exactly the bug that
stopped the app launching in v7.63, one file along. The banner's own comparator
treats a missing part as `0`, so both readers agree about the same string.

Generate it, never type it:

```bash
node frontend/devtools/build-release-manifest.mjs                        # notify only
node frontend/devtools/build-release-manifest.mjs --artifacts <dir>      # with installers
```

Without `--artifacts` it emits no `platforms` at all, which is the correct
output before a signed build exists: an empty map would put an Install button
on screen with nothing behind it.

## Cutting a release

Run the **Publish Update** workflow (`.github/workflows/publish-update.yml`)
from the Actions tab and give it the tag. It:

1. gates on `check-updater-config --release`, which refuses to go on without a
   signing key;
2. builds macOS, Windows and Linux with `--config src-tauri/tauri.release.conf.json`,
   which is what turns updater artifacts and signing on;
3. generates `latest.json` from what was actually built;
4. uploads the installers to the **public** releases repo, **then** pushes the
   manifest — in that order, because a manifest published before the files it
   names sends every running copy to a 404.

It is a separate workflow from `release.yml` on purpose: that one is inherited
from upstream OpenDraft, builds Android/iOS/Mac App Store/Docker, and its
publish job verifies seven assets this product does not ship.

---

## What still has to be set up

### 1. The public releases repo

`dac8767/ScriptCraft-releases`, **public**. The source repo is private, and
`raw.githubusercontent.com` will not serve a file from a private repo without a
token — a token shipped inside the app is a token anybody has. The repo needs
nothing in it but `latest.json` on `main`; the installers live on its Releases.

Until it exists, `Help ▸ Check for Updates…` answers *"The update server
answered 404."* — which is the honest thing for it to say, and is what it has
been saying since v7.62.

### 2. The Tauri signing key

```bash
npm run tauri signer generate -- -w ~/.tauri/scriptcraft.key
```

- the `.pub` half → `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- the private half → GitHub secret `TAURI_SIGNING_PRIVATE_KEY`
  (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you set a passphrase)

**Keep a copy of the private key somewhere safe.** Every installed build
verifies against the public key baked into it, so losing the private half means
no copy already in the field can ever accept another update.

This is Tauri's own signing, and it is a different question from Apple's: it
answers "is this really the file ScriptCraft published", where a Developer ID
answers "will macOS open this at all". Neither substitutes for the other.

`check-updater-config` prints a NOTE about this every run and turns it into a
hard failure under `--release`, so a release cannot be cut without it.

### 3. A token that can write to the releases repo

A fine-grained PAT with **Contents: write on `ScriptCraft-releases` only**,
stored as `RELEASES_REPO_TOKEN`. `GITHUB_TOKEN` is scoped to the source repo
and cannot write to another one.

---

## The risk that is still open

The macOS app is **unsigned** (§6 of `CLAUDE.md` — the Developer ID is the top
open item). An unsigned bundle that replaces itself is the one failure a tester
cannot walk back, and that risk was raised before this was built; Derek's call
was to build it anyway. The mitigations in the code are:

- the Download link is never removed, so there is always a manual road;
- the installer is only offered when the release really carries one for that
  machine;
- every failure — no key, no artifact, a dead download — produces a sentence
  that names the problem and points at the link.

None of that makes an unsigned self-replacing bundle safe. Getting the
Developer ID remains the thing that does.
