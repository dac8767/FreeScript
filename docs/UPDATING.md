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

# Setup, step by step

Three things have to exist. Do them in this order — step 3 needs the repo from
step 1 to exist before you can scope a token to it.

Everything below assumes you are on your Mac, in `/Users/dcarl/ScriptCraft`.

---

## Step 1 — The public releases repo

**Why it is a second repo.** `dac8767/ScriptCraft` is private.
`raw.githubusercontent.com` will not serve a file out of a private repo without
an access token, and a token shipped inside the app is a token that anybody who
downloads the app has. A public repo holding nothing but release artifacts and
one small JSON file leaks nothing and costs nothing.

### Create it

1. Go to **https://github.com/new**
2. **Owner**: `dac8767`
3. **Repository name**: `ScriptCraft-releases`
   *Exactly that.* The string appears in `src-tauri/tauri.conf.json` and in
   `frontend/src/services/updateCheck.ts`, and a check compares the two — but
   neither knows whether the repo on the other end is real.
4. **Public** — not private. This is the entire point of the repo. A private
   one behaves *identically to not existing*: the app gets a 404 either way,
   which is the hardest possible version of this to debug.
5. Tick **Add a README file**. This matters more than it looks: the publish
   workflow clones the repo and commits `latest.json` to `main`. A repo with no
   commits has no `main` branch to clone, and the push has nothing to push to.
   The README is there to create that first commit.
6. Leave .gitignore and licence as None.
7. **Create repository**.

### Check it worked

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/dac8767/ScriptCraft-releases/main/README.md
```

`200` means the repo is public and `main` exists — both halves of what the app
needs. `404` means it is private, misnamed, or has no commit yet.

The app will still say *"The update server answered 404"* at this point, and
that is correct: `latest.json` does not exist until the first release publishes
it. That is step 4.

---

## Step 2 — The Tauri signing key

**What this is.** A minisign keypair. Every update the app downloads carries a
detached signature made with the private half; the app refuses to install
anything that does not verify against the public half baked into it. It is what
stops a tampered download — or a compromised release repo — from replacing
someone's app with something else.

**It is not Apple's signing.** Apple's Developer ID answers *"will macOS agree
to open this at all"*. This answers *"is this really the file ScriptCraft
published"*. You need both eventually and neither substitutes for the other.

### Generate it

```bash
cd /Users/dcarl/ScriptCraft
mkdir -p ~/.tauri
./frontend/node_modules/.bin/tauri signer generate -w ~/.tauri/scriptcraft.key
```

Use that path to the binary, not `npm run tauri` — the root `package.json` has
a `tauri` script but no local install behind it; the CLI lives in
`frontend/node_modules`, which is how `npm run app` invokes it.

It asks for a password. **Either answer is fine** — decide now, because it
changes what you store in step 3:

- **Press Enter twice for no password.** Simplest. The private key file is then
  the only secret, and the release workflow needs one secret instead of two.
- **Type a passphrase.** Slightly safer if the key file leaks on its own. You
  then also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in step 3, and if you lose
  the passphrase the key is as dead as if you had lost the file.

You will see:

```
Your keypair was generated successfully:
Private: /Users/dcarl/.tauri/scriptcraft.key (Keep it secret!)
Public: /Users/dcarl/.tauri/scriptcraft.key.pub
```

### Put the public half in the repo

```bash
cat ~/.tauri/scriptcraft.key.pub | pbcopy
```

Open `src-tauri/tauri.conf.json`, find:

```json
"updater": {
  "endpoints": [ "https://raw.githubusercontent.com/..." ],
  "pubkey": "",
```

and paste between the quotes, so it reads `"pubkey": "dW50cnVzdGVk…"`.

**Both key files are one line of base64 and look alike. Do not paste the wrong
one.** The public key is about 150 characters; the private key is about 350.
If what you pasted is noticeably longer, you have pasted the secret — undo it,
and generate a fresh pair, because the old one has been in a file you were
about to commit.

### Check it worked

```bash
node frontend/devtools/check-updater-config.mjs --release
```

Before: a `NOTE` saying there is no key. After: `19 passed, 0 failed`, including
`a public key is configured`. If it says *"looks like a placeholder"*, something
other than the key contents got pasted.

Then commit it — the public key belongs in the repo, in every build:

```bash
git add src-tauri/tauri.conf.json && git commit -m "updater: add the signing public key"
```

### Back the private key up. Properly.

```bash
cp ~/.tauri/scriptcraft.key ~/Documents/scriptcraft-signing-key-BACKUP.txt
```

…and put a copy somewhere that is not this Mac — a password manager entry is
ideal, since it is one line of text.

**Why this one is unforgiving.** Every copy of the app in the field verifies
against the public key compiled into it. If you lose the private half, you
cannot sign anything those copies will accept — not a fix, not a rollback,
nothing. The only road back is a new keypair in a new build that everybody has
to install *by hand*, which is precisely the situation the updater exists to
prevent. It is one line of text; treat it like the only copy of a master.

---

## Step 3 — A token that can write to the releases repo

**Why the built-in one will not do.** Actions gives every workflow a
`GITHUB_TOKEN`, but it is scoped to the repository the workflow runs in. The
build runs in `dac8767/ScriptCraft` and has to publish into
`dac8767/ScriptCraft-releases`, and no automatic token crosses that line.

### Create the token

1. Go to **https://github.com/settings/personal-access-tokens/new**
   (Settings → Developer settings → Personal access tokens → **Fine-grained
   tokens** → Generate new token. Use fine-grained, not "classic" — a classic
   token cannot be limited to one repository, so a leak would expose everything
   you own.)
2. **Token name**: `ScriptCraft release publisher`
3. **Expiration**: your call. A year is reasonable; whatever you pick, the
   publish job starts failing on that date, so put it in a calendar.
4. **Resource owner**: `dac8767`
5. **Repository access**: **Only select repositories** → pick
   **`ScriptCraft-releases`**. Only that one. It is the only repo this token
   ever needs to touch.
6. **Permissions** → **Repository permissions** → find **Contents** → set to
   **Read and write**. Leave everything else alone. Contents covers both halves
   of what the workflow does: creating the release with its installers, and
   committing `latest.json`.
7. **Generate token**, then **copy it immediately** — GitHub shows it once.

### Store the secrets

All three go on the **source** repo, `dac8767/ScriptCraft` — that is where the
workflow runs. Putting them on the releases repo is the easy mistake, and it
fails with a confusing "not found" rather than "no permission".

Go to **https://github.com/dac8767/ScriptCraft/settings/secrets/actions** →
**New repository secret**, once per row:

| Name | Value |
|---|---|
| `RELEASES_REPO_TOKEN` | the token you just copied |
| `TAURI_SIGNING_PRIVATE_KEY` | the **contents** of `~/.tauri/scriptcraft.key` — `cat ~/.tauri/scriptcraft.key \| pbcopy` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the passphrase from step 2 — **skip this row entirely if you set none** |

`TAURI_SIGNING_PRIVATE_KEY` is the file's *contents*, not its path. The runner
has no `~/.tauri` directory.

### Check it worked

The three secrets should be listed by name on that page (values are never shown
again). Nothing else can be verified until the first release runs.

---

## Step 4 — Cut the first release

```bash
cd /Users/dcarl/ScriptCraft
git tag v7.78 && git push origin v7.78
```

Then **Actions → Publish Update → Run workflow**, enter the tag `v7.78`, and
run it. It gates, builds three platforms, generates the manifest, uploads the
installers, and pushes `latest.json` last.

When it is green:

```bash
curl -s https://raw.githubusercontent.com/dac8767/ScriptCraft-releases/main/latest.json
```

You should see the version, the notes, and a `platforms` block. From that
moment, every copy of the app older than that version offers the update — and
Help ▸ Check for Updates… stops saying 404 for the first time since v7.62.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| `The update server answered 404` | `latest.json` is not published yet, or the repo is private / misnamed. Re-run the `curl` from step 1. |
| Preflight fails on `a public key is configured` | Step 2's paste did not land, or was not committed and pushed. |
| Publish job fails with *not found* on the releases repo | The token is missing, expired, scoped to the wrong repo, or the secrets went on the releases repo instead of the source repo. |
| Build fails with a signing error | `TAURI_SIGNING_PRIVATE_KEY` holds a path instead of the file's contents, or the passphrase secret is missing / wrong. |
| Banner appears but shows only **Download** | Correct behaviour when the release has no installer for that machine, or the copy is running in a browser. Check `platforms` in `latest.json` for that architecture. |
| *"This build cannot verify updates"* on pressing Install | That build was compiled before the public key was added. It has to be replaced by hand once; every build after it updates itself. |

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
