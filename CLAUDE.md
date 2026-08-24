# ScriptCraft — working notes for Claude

> **Naming history:** OpenDraft (upstream) → FreeScript (repo name) → FreeDraft
> (v0.5–v1.33) → **ScriptCraft** (v1.34, Derek's rename). v3.14: the repo and
> Derek's clone are renamed to ScriptCraft too (`dac8767/ScriptCraft`,
> `/Users/dcarl/ScriptCraft` — GitHub redirects the old URLs). The
> `.odraft` format, the `com.freedraft.app` bundle id and the `opendraft:*`
> storage keys STILL keep their old names on purpose — renaming identifiers
> that persist data or define the app's identity orphans user data.

Read this before touching anything. It is the residue of 100 shipped versions, and
most of it is the kind of thing you only learn by getting it wrong first.

> The previous `CLAUDE.md` was inherited from upstream Proteus OpenDraft and
> describes a different project (an open-core/Pro split that does not exist here, a
> Mac App Store path that is ruled out). It is archived at
> `docs/UPSTREAM-OPENDRAFT-NOTES.md` with a warning header. Don't follow it blindly.

---

> **Fresh chat? Read `docs/HANDOFF-CONTINUE.md` first** — the current state (v3.54),
> the dual-branch push workflow this environment uses, what shipped recently, and the
> live architecture. Then **`docs/HANDOFF.md`** for the working process and history
> (v1.9–v1.21: projects removed, Save/Save As rebuilt, the Tauri fs scope, the Dev
> Picker's shape) — its §1 workflow is superseded by HANDOFF-CONTINUE.md §0, but its
> footguns and Derek-practices sections still hold.

## 0. The thing you are probably confused about

**There is no Codespace connection. There never was.**

If you went looking for how a previous Claude "connected to the Codespace and added a
zip," you were chasing a ghost. What actually happened:

- That Claude ran in a **sandboxed container of its own**, holding its own clone of
  `github.com/dac8767/FreeScript`, authenticated by a PAT in the remote URL.
- It **could not touch Derek's machine.** Not the Codespace, not the Mac. No shell, no
  filesystem, no network path to either.
- So it worked the only way it could: edit files in its own clone → commit → **push to
  `claude/v0_32`** → Derek runs `git pull` on his Mac.
- The `freescript-vX_Y-*.zip` files in the repo root are **committed artifacts**, not a
  transfer mechanism. A chat window can't hand someone a file, so a zip of the changed
  files got committed alongside each change.

**You are not in that situation.** You have direct filesystem access to the repo on
Derek's Mac. Therefore:

- **Do not create delivery zips.** They were a workaround for a constraint you don't
  have. The existing ones are historical — leave them, don't add more.
- Edit files directly, verify, commit, and tell Derek to restart the app.

---

## 0.5 If the code you are reading is not the code you wrote

**The container's disk gets restored from a stale snapshot, mid-session.** It
has landed on the same one every time: HEAD at `87e94b8` (v6.67,
2026-08-10 04:27) with five files dirty — MarkupPickers, MarkupsPanel,
Toolbar, toolbarBuiltins + its test. The repo, `.git` and all come back with
it.

**Nothing is ever lost.** Every pushed commit survived every occurrence; the
remote is the truth. The damage is subtler and worse: *working on a stale
tree without noticing*. It nearly shipped twice — once a whole feature
(`check-all --changed`) was simply absent from a file being edited, spotted
only because the code on screen did not match the code remembered.

**It is not git, and no git command will show you.** A `git reset` APPENDS to
the reflog and cannot erase what came before. After the last restore the
reflog jumped from 2026-08-10 straight to the recovery — six days and a dozen
commits missing — while every one of those commits was still on the remote.
`.git/HEAD`, which git rewrites on every checkout, was three weeks old. That
is a filesystem restore. It is the platform's container, and its stated
contract is "commit and push or lose it" — which is honoured.

**So the fix is detection, and it is wired up:**

```bash
node frontend/devtools/check-fresh.mjs     # fetches, compares, explains
```

- runs at **SessionStart** (`.claude/settings.json`),
- runs first inside **`check-all`**, which ABORTS rather than spend five
  minutes testing a tree that is not yours.

**Recover, then verify BY CONTENT — never by commit id.** A restored tree has
once read as the right sha with the wrong blobs:

```bash
git fetch origin claude/v0_32 && git reset --hard origin/claude/v0_32
grep APP_VERSION frontend/src/data/changelog.ts
```

**And push every version the moment it is green.** That is what has made every
one of these a nuisance instead of a loss.

---

## 1. What this is

A professional screenwriting desktop app, forked from Proteus's OpenDraft.

| | |
|---|---|
| **Frontend** | React 19 + TypeScript + Vite, TipTap editor (`frontend/`) |
| **Backend** | FastAPI, SQLite, dulwich for script history |
| **Desktop** | Tauri (WebKit on macOS), shipping as a signed `.dmg` |
| **Repo** | `dac8767/ScriptCraft` (renamed from FreeScript in v3.14; old URLs redirect), branch **`claude/v0_32`** |
| **Derek's clone** | `/Users/dcarl/ScriptCraft` |

**`main` is a stale v0.6 baseline. Never commit to it.** All work is on `claude/v0_32`.

Derek is the product owner and the only tester. He gives direction, tests each build on
his Mac, and reports back. Claude writes all the code.

---

## 2. The verification gates — run these before claiming anything works

```bash
cd frontend
npx tsc -b     # MUST be 0 errors. Not "baseline", not "pre-existing". Zero.
npm test       # currently 61 tests, all must pass
npm run build  # tsc -b && vite build — must succeed
```

**Why `npm run build` matters, and why skipping it is not harmless.** Tauri's
`beforeBuildCommand` is `cd frontend && npm run build`, which starts with `tsc -b`. For
weeks there were eight "harmless" unused-variable errors that everyone — including me —
treated as an acceptable baseline. They were not a baseline. They were failing the tsc
gate, which meant **`tauri build` could not produce a `.dmg` at all.** The release was
blocked in plain sight, and nobody noticed, because `tauri dev` doesn't run tsc.

They are fixed. Typecheck is clean at zero. **Keep it there.** An unused import is not a
lint nit in this repo; it breaks the release build.

**Changing a DEFAULT is a suite-wide event** (v7.70, learned the hard way). The
app's defaults are Derek's own preset now — his 140% zoom, his Design values,
his hidden helper text, his tool modes. Fifty-two assertions across sixteen
check files went red the moment that landed, almost all of them fixtures that
had quietly assumed a stock profile. The driver has helpers that state the
reason once (`zoom100`, `showAllHelperText`, `useSceneList`, `placeTool`); use
them rather than writing the same explanation sixteen times. And read the
failures before "fixing" them — two of those fifty-two were real bugs that only
a real person's configuration could expose.

**Write real tests for anything with logic in it.** `vitest` is wired for jsdom, so
components can be rendered and inspected (`src/**/*.test.tsx`). Two of the worst bugs in
this project's history were found by rendering the thing in a test and reading back what
it actually produced — not by staring at the source and reasoning.

---

## 3. How Derek works, and what he expects

- **Root cause, not symptom.** "Why is it doing that" before "make it stop doing that."
  He spots patches and dislikes them.
- **Single source of truth.** If something appears in two places, it must be driven by
  one shared source. Nearly every bug in this codebase's history is two lists that
  drifted apart: a menu icon map that didn't match the menu, a card component copied
  instead of shared, a hardcoded shortcut list that ignored the user's rebindings.
  Before adding a second copy of anything, don't.
- **Silent no-ops are the cardinal sin.** A control that looks like it works and writes
  into the void is worse than a missing control. Several examples in §4.
- **Honest risk assessment.** If something is too risky, say so and say why. Deferring
  with a reason is respected; quiet failure is not. If you got something wrong, say that
  too — plainly, and then fix it.
- **He renames things constantly.** When he does, rename everywhere, immediately.
  v7.81 addendum, his words: *"any changes made to the equivalent sections in
  settings should be made in the customize window as well"* — the Settings
  sidebar and the Customize window show the same tabs, and a rename or text
  change in one lands in both in the SAME change ("Ribbon Toolbar" reached
  Settings first and left Customize saying "Toolbar" for three versions).
- **The About window's open-source list tracks the real dependencies** (v4.76,
  Derek's standing rule): removing a tool that retires a library — or adding or
  swapping one — updates the "Made possible by open source" list in
  `AboutDialog.tsx` as part of the SAME change.
- **The Helper Text window tracks the real helper text** (v6.51, Derek's
  standing rule): any change that adds, removes, or rewords helper text
  (tooltips, placeholders, `ht()` hints) reruns
  `node devtools/build-helper-catalog.mjs` as part of the SAME change, so the
  Helper Text window's list always matches the app. `check-helper-catalog`
  fails the suite when the committed catalog drifts — and since v6.51 the
  builder harvests string literals out of dynamic `title={…}` expressions
  too, so ternary tooltips are covered, not just literal attributes.
- **The queue always includes the open feedback** (v7.26, Derek's standing
  rule): *"anytime I ask to see the queue, include incomplete items from the
  feedback list. if the feedback items are from me, still show the item in the
  queue list."* Asked for the queue / "what's next" / "what's in the queue",
  read the `feedback_report` view (default filter `status=neq.Complete`) and
  fold every open row into the list — **his own rows included**. He files most
  of them himself and still expects to see them there; a queue that omits them
  is not the queue. Rows are marked Complete only when the work ships.
  Credentials: `$SUPABASE_SECRET_KEY`, never printed. Read the
  `feedback_report` view, PATCH the `feedback` table.
- **Icons are always monotone** (react-icons line style, currentColor). Never emoji
  in UI chrome — v2.08 swept the Scrapbook's 📄🗂🗑 for exactly this.
- **The size scales** (v7.02, from the style audit — conform, don't invent):

  | Thing | Size | Token |
  |---|---|---|
  | Action button (dialog footers, wizards) | 34px / 14px text | `--dz-dialog-btn-h` |
  | Compact button (small floating panels, popups) | 26px / 12px | `--dz-dialog-btn-h-sm` |
  | Dropdown | 28px / 12.5px | `--dz-select-h`, `--dz-select-font` |
  | Dropdown in the toolbar row | 22px | `--dz-select-h-compact` |
  | Text field in a dialog | 36px | `--dz-dialog-input-h` |
  | Window title | 16px | `--dz-dialog-header-font` |
  | Panel / tool-window title | 13px | `--dz-toolwin-title-font` |
  | Section heading inside a window | 11.5px, `--fd-text-muted` | — |
  | Corner radius | 5px | `--dz-dialog-btn-radius` |

  A knob's `def` in `designTokens.ts` MUST equal the fallback literal in the CSS
  (`var(--dz-x, 5px)`) — a test enforces it, and changing one without the other
  fails the suite. Deliberate exceptions exist (the toolbar's compact dropdown,
  the Characters tool's 26px profile fields); they carry a comment saying why.
- **Colors come from tokens, never from a hex literal** (v7.01, after the style
  audit). Chrome reads `--fd-danger` / `--fd-success` / `--fd-warning` /
  `--fd-accent` and the surface tokens; a raw `#c0392b` in a component or a
  stylesheet is a bug. `src/styles/tokenResolve.test.ts` fails the suite if a
  `var(--fd-…)` names a token no theme defines — the exact failure that left ~50
  hover and selected states painting nothing through v7.00. A NEW token must be
  defined in `:root` **and** added to `THEME_VARS` (themes.ts) or custom themes
  can't reach it. The exception is a user-facing color PALETTE (annotation
  colors, index-card colors): those are choices, not states, and stay literal.
- **Buttons: `dialog-btn` + a modifier, never a paint-only class** (v7.01). The
  retired `dialog-primary` set a color but no size, so it looked right in a
  dialog's button row and like a native browser button anywhere else. The test
  above fails the suite if it reappears.
- **Never `window.confirm` / `alert` / `prompt`** — in Tauri they are async IPC
  shims that return a Promise, and a Promise is always truthy, so `if (confirm(…))`
  runs whatever the user answers. Use `confirmDialog` / `promptDialog`. Enforced
  by the same test file.
- **Never comment on the time of day or suggest he sleep.**

**End EVERY message that delivers a change with the terminal command.** v7.31,
Derek: *"remember to always send the terminal code when you've finish an
update."* ALWAYS — not when you judge a restart necessary. Docs-only, a
comment, a one-line fix, a test that never ships: send it anyway. Deciding
"this one doesn't need a restart" is his call, not yours, and getting it wrong
costs him a message asking for the line every time.

```
cd /Users/dcarl/ScriptCraft && npm run desktop
```

`npm run desktop` = restore `src-tauri/Cargo.lock` (v5.55 — a local `tauri dev`
rewrites that generated file and a dirty copy aborted `git pull`; the committed
lockfile is canonical) → `git pull` → `npm install` (a no-op unless deps changed — this is
what stops the baffling "Cannot find package" after a pull) → launch the Tauri app.
It's `&&`-chained, so a failed pull stops rather than launching a half-merged tree.
`npm run app` launches without pulling.

**`npm run desktop:build`** is the same restore → pull → install, then a
LOCAL UNSIGNED `.app` (`./build-desktop.sh --local`) — for testing anything
the OS has to know about, above all FILE ASSOCIATIONS. macOS reads those
from Info.plist, written at BUILD time, and `tauri dev` never installs a
bundle, so a dev session can never register one. v7.31: never hand Derek a
bare `git pull` — the generated lockfiles (`Cargo.lock`,
`frontend/package-lock.json`) are rewritten by his own local runs and a
dirty one aborts the merge. Give him the npm script, which restores them
first.

(If you edited his working copy directly he may not need `git pull` — but he does need
to restart the app.)

---

## 4. The footguns — read this section twice

Every one of these shipped as a real bug. Each cost hours.

### WebKit / Tauri
- **Drag-and-drop silently does nothing unless you call `dataTransfer.setData()`.**
  WebKit refuses to start a drag without it; Chrome doesn't care. So it looks perfect in
  a browser and is stone dead in the app. Every drag handler must call it.
- **`position: fixed` + only `bottom` + `max-height` + `overflow: auto` collapses the box
  to a sliver.** Anchor floating things by measured `top`/`left`. Never by `bottom`.
- **An absolutely-positioned child cannot escape an ancestor's stacking context or
  `overflow`, no matter its z-index.** Menus inside side panels must be portalled to
  `document.body` and positioned with fixed coordinates measured from their trigger.
  (See `AddMenu.tsx` and `AddMenu.placement.test.tsx`.)

### TipTap / ProseMirror / pagination
- **`showOnlyCurrent: false` on the Placeholder extension makes EVERY empty element in
  the document display its hint simultaneously.** It was set that way to light up both
  columns of a dual dialogue; the cost was three "Describe the action..." prompts stacked
  down the page.
- **The pagination plugin's `apply()` ignores transactions without `docChanged`** unless
  they carry `setMeta('forceRepaginate', true)`. Every refresh dispatch must set it.
- **If you hide something in the script visually, tell the paginator too.** `display: none`
  alone leaves a phantom page in the count and shifts every subsequent page number by one.
  See `hideTitlePage` in `editor/pagination.ts`.
- **Never rename the `scriptNote` mark or the tool ids.** User-visible strings were renamed
  ("Script Note" → "Note"), but the internal mark name is what every note in every saved
  script points at. Rename it and you orphan them all.

### React / Node
- **Hooks must never appear below an early return** in dialog components → "Rendered more
  hooks than during the previous render" crash.
- **`IncomingMessage` emits `'close'` when the request body has been fully READ**, not when
  the client disconnects. Cleanup hung on `req.on('close')` kills the thing you just
  started. Use `res.on('close')` with a `finished` guard.

### Working notes must never leave the app
Sections (`# ...`), markers (`⚑ ...`), script to-do lines (`[ ] ...`) and note highlights are
scaffolding for the writer, not part of the script. They are **hidden in Preview,
suppressed unconditionally in print, and filtered out of the Fountain exporter.** The
exporter used to write them into the file verbatim — drafts went to collaborators carrying
Derek's private to-do list. If you add a new kind of working note, it must be excluded from
all three.

---

## 5. Architecture map

| File | What lives there |
|---|---|
| `stores/editorStore.ts` | `ToolId`, tool config/order, `SHELF_COLORS`/`NOTE_COLORS`, script-visibility flags, `ALWAYS_FLOAT`, `DEV_TOOLS`, view-state persistence |
| `stores/formattingTemplateStore.ts` | `getPickableElements()` — the canonical element list |
| `stores/seedDefaults.ts` | **The app's shipped defaults** (v7.70) — writes `data/defaultPreset.json` into localStorage once, for absent keys only, and merges the five built-in workspaces on every load. Called from the TOP of `viewState.ts`, before `_vs` is read: move it and the defaults reach nothing. |
| `stores/workspaceFields.ts` | `WORKSPACE_FIELDS` — what a workspace snapshot holds. A leaf, because the slice and seedDefaults both need it |
| `devtools/build-default-preset.mjs` | Turns one of Derek's preset exports into that bundle; the keys it drops are named there, with reasons |
| `components/ToolDock.tsx` | `ALL_TOOLS` (the tool registry), `WINDOW_IDS`, docking, drag-to-resize panel edge |
| `components/StickyCard.tsx` | **THE** card. Notes and To-Do both render it. Do not fork it. |
| `components/ListControls.tsx` | Filter / sort / manual-order shared by Notes and To-Do |
| `components/AddMenu.tsx` | Portalled dropdown used throughout Customize |
| `components/uiIcons.tsx` | `MENU_ICONS` / `TOOLBAR_ICONS` — one registry, read by the UI *and* Customize |
| `components/CustomizePanelsDialog.tsx` | Customize tabs. **Hide = remove-and-stash**, in every tab. |
| `editor/pagination.ts` | Page breaking, `visibilityOpts` |
| `utils/fountainExporter.ts` | Export — filters working notes |
| `styles/screenplay.css` | All styling. One large file. |

**The Dev Picker is GONE** (removed v3.25 at Derek's request — it lived in `src/dev/`,
DEV-only). It let him click a UI element and get its *real internal name* into a note —
`Notes — Right Panel`, `toolbar key: bold`. **If he pastes names in that form, they came
from there (an older build) and they are exact.** Recover it from git history if he ever
wants it back.

---

## 6. Open items

> Re-verified v7.66 against the tree, one item at a time. Half of what this
> list used to say was already done — it named the brand art as "the biggest
> release blocker" months after that art shipped, and it nearly sent this
> session chasing a PAT that is not there. **Check before you act on a line
> here, and correct the line when you do.**

### Actually still open

- **Apple Developer Program ($99/yr), and your own signing identity.**
  `build-desktop.sh:51` still exports
  `Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)`
  — Proteus's certificate, whose private key we do not have. Unsigned means
  Gatekeeper's "cannot be opened because the developer cannot be verified".
  Nothing else on this list matters until the app opens.
- **Courier Prime ships with no licence file.** Four `.ttf` in
  `frontend/public/fonts/` and no OFL text anywhere. SIL OFL 1.1 permits
  commercial bundling but REQUIRES the licence travel with the font. One file.
- **Trademark clearance on "ScriptCraft".** Not searched. The name is in use
  elsewhere (there is a well-known open-source ScriptCraft for Minecraft), and
  screenwriting software is a dense category. USPTO TESS is free.
- **`docs/PRIVACY.md` is now false, and it is about to carry your name.** It
  says the app is "developed by Proteus Technologies Private Limited", collects
  nothing, and that "the only optional network feature is real-time
  collaboration". The app now talks to Supabase (feedback, INCLUDING uploaded
  screenshots), raw.githubusercontent.com (the update check), Google Fonts,
  jsDelivr + LibreOffice (dictionaries), and Google/Microsoft if Drive or
  OneDrive is configured.
- **The Supabase feedback key ships to whoever has the app.** Publishable by
  design, and fine while the readers are testers. Confirm the `feedback` table
  is insert-only with no select, and that `feedback-shots` has size and rate
  limits, before it is on the open internet.
- **Nothing gates the app.** No licence key, no trial, no activation, no
  payment path anywhere in the tree. If it is to be sold, a merchant of record
  (Paddle / Lemon Squeezy) also solves EU VAT, which applies from the first
  euro of consumer sales.
- **Windows and Linux build but are unsigned.** The CI matrix produces all
  three. Unsigned Windows means SmartScreen on every download; see
  `docs/WINDOWS_SIGNING.md`.
- **`macos-private-api` is enabled** in `src-tauri/Cargo.toml` — this **rules
  out the Mac App Store**. Fine for the `.dmg` plan, but know it.

### Done — do not re-open these

- ~~Rotate the GitHub PAT~~ — the remote is a plain
  `https://github.com/dac8767/ScriptCraft`, no token embedded.
- ~~Replace all OpenDraft brand art~~ — icons, splash and favicon are all the
  SC artwork; the whole set was regenerated onto Apple's grid in v7.65.
- ~~Dictionaries fetched from Proteus's CDN~~ — LibreOffice's own repo now,
  and Odia SHIPS WITH THE APP (v7.67). It had been fetched from jsDelivr's
  `/gh/` endpoint, which serves public repos only, so it 404'd from the day
  that line was written — silently, because a failed download is
  indistinguishable from a language nobody selected. Do not put a CDN back:
  the alternative was publishing the whole commercial source to serve one
  7.6 MB word list.
- ~~Dependency licences~~ — audited v7.65: 463 packages, 376 MIT / 26 ISC /
  20 Apache-2.0, no viral copyleft. JSZip is dual MIT-or-GPL (elect MIT); three
  MPL-2.0 are file-level only. Upstream OpenDraft is **MIT**, so a closed-source
  commercial product is permitted provided the notice ships. No TipTap Pro.

---

## 7. Summary for the impatient

1. There was never a Codespace connection. **Don't make zips.**
2. Branch `claude/v0_32`. Never `main`.
3. `npx tsc -b` must be **zero** errors — it gates the release build.
4. `npm test` and `npm run build` must pass before you claim anything works.
5. One source of truth for anything that appears twice.
6. Call `dataTransfer.setData()`. Portal your menus. Position by `top`, never `bottom`.
7. Root cause, not patch. Be honest when something is risky — or when you got it wrong.
