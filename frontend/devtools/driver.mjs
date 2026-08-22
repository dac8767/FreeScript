// devtools/driver.mjs — shared Playwright driver kit (speed audit, 2026-07-28)
//
// WHY THIS EXISTS. Derek: "this is getting very slow again. the last few small
// updates took 11 minutes." The audit (docs/SPEED-AUDIT-2026-07-28.md) traced
// most of that to the verification drivers, each hand-written per check and
// each paying the same tax:
//
//   1. TYPING the fixture script through the UI — 30–110 lines at keystroke
//      granularity, ~30–60s per run. Fixed by injection: ScreenplayEditor
//      exposes the TipTap instance as window.__scEditor in DEV builds, and
//      seedScript() hands it a whole document at once.
//   2. FIXED WAITS — waitForTimeout(4000) after boot plus 6–9 scattered
//      600–2000ms sleeps. Fixed with event-driven waits on real conditions.
//   3. REBUILDING THE KIT — drivers lived in the session scratchpad, which
//      sandbox rollbacks wipe (it happened mid-audit). This kit lives in the
//      repo. It is dev tooling: outside src/, invisible to tsc, vitest and
//      the release build.
//
// Usage (from frontend/, with Vite on :5199):
//   import { launch, boot, seedScript, openTool, fullscreen, SCENES_4 } from './devtools/driver.mjs';
//   const { browser, page } = await launch();
//   await boot(page);                    // app up, dialogs cleared
//   await seedScript(page, SCENES_4);    // whole script injected in one call
//   await openTool(page, 'Scenes');
//   ... assertions ...
//   await browser.close();

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const VITE_URL = 'http://localhost:5199/';

/** The shipped default of one Design knob, read from designTokens.ts.
 *
 *  v7.76: Derek's own Design numbers ARE the token defaults now, so five
 *  checks that had his old defaults typed into them as literals ("old default
 *  1", "the built-in 30px") all went red at once — every one of them a fixture
 *  restating a number rather than testing anything. A check that hardcodes a
 *  default is asserting that nobody ever changes it.
 *
 *  So they read it from the same file the app reads, and what they assert is
 *  the part that can actually break: that the default REACHES THE PIXELS. Left
 *  as literals, the next preset he sends would light up the same five again.
 *  One reader, because five copies of this regex is exactly the drift
 *  CLAUDE.md's single-source rule is about. */
const TOKENS_SRC = readFileSync(new URL('../src/design/designTokens.ts', import.meta.url), 'utf8');
export function tokenDefault(id) {
  const at = TOKENS_SRC.indexOf(`id: '${id}'`);
  if (at < 0) throw new Error(`tokenDefault: no knob with id '${id}' in designTokens.ts`);
  // Negatives are real defaults (ribRowGapUntitled is -3), so the sign is part
  // of the number — a [0-9.] class here silently read "-3" as 3.
  const m = TOKENS_SRC.slice(at).match(/def:\s*(-?[\d.]+)/);
  if (!m) throw new Error(`tokenDefault: knob '${id}' has no def:`);
  return Number(m[1]);
}

/** The standard fixture: 4 scenes, unequal lengths so page counts, runtimes
 *  and the length icons all differ — the shapes the Scenes tools care about. */
export const SCENES_4 = [
  { heading: 'EXT. SPACE - OPENING SCROLL', lines: 2 },
  { heading: 'EXT. SPACE - BELKADAN', lines: 12 },
  { heading: 'INT. SPACE CARRIER - BRIDGE', lines: 40 },
  { heading: 'INT. CARRIER - HANGER BAY', lines: 20 },
];

export async function launch(opts = {}) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
    viewport: { width: opts.width ?? 1500, height: opts.height ?? 900 },
    // dpr 1 unless a screenshot is the point — dpr 2 quadruples capture cost.
    deviceScaleFactor: opts.dpr ?? 1,
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  /* FAIL FAST. Playwright waits 30s before admitting a selector will never
     match — and a check that needs more than a few seconds for one click is
     broken, not slow. Every wrong guess while writing a check used to cost
     half a minute; now it costs eight seconds. Raise it locally with
     page.setDefaultTimeout() in the rare check that genuinely waits. */
  page.setDefaultTimeout(opts.timeout ?? 8000);
  /* NAVIGATION gets far more room than an action does, and the distinction
     matters. A selector that will never match should fail in 8s. But a page
     load is I/O against a dev server that may be serving nine browsers at
     once (the runner's 4 files × check-v582's own 5 shapes) — that is slow,
     not broken, and failing it fast just produces noise. Measured: three
     goto timeouts at 15s under full load, none at 45s. */
  page.setDefaultNavigationTimeout(opts.navTimeout ?? 45000);
  return { browser, page };
}

/** App booted, storage cleared, startup dialogs gone. Event-driven: waits on
 *  the editor existing, not on a stopwatch. */
export async function boot(page) {
  /* ONE load, not two. This used to load the app, clear localStorage, and
     reload — so every check paid the app's startup cost twice, ~49 times
     over. An init script runs before any page script on the FIRST load, so
     the app comes up with clean storage the first time and the reload goes. */
  await page.addInitScript(() => {
    /* ONCE, on the first load only. An init script runs before every
       navigation, so an unguarded clear() also wipes whatever a check seeded
       into localStorage before its own reload — check-v551 seeds a stale
       toolbar layout and reloads to watch it migrate, and lost it. The marker
       lives in sessionStorage, which survives a reload but not a new page. */
    try {
      if (!sessionStorage.getItem('__driver_cleared')) {
        localStorage.clear();
        sessionStorage.setItem('__driver_cleared', '1');
      }
    } catch { /* storage unavailable on the very first navigation */ }

    /* v7.15 — THE SECOND-INSTANCE TRAP, made impossible to fall into.
       A check that wants the app's live module writes
       `await window.__scImport('/src/services/api.ts')`, never a bare
       `import('/src/services/api.ts')`.

       Why: Vite stamps an invalidated module with a cache-buster, so a dev
       server that has seen ANY edit serves the app
       `/src/services/api.ts?t=1786775615204` while a bare import gets
       `/src/services/api.ts` — a SECOND copy of the module, with its own
       state. check-v673 patched api.getVersions on that copy, the panel went
       on calling the real one, and the check failed in a way that looked
       like a regression in Script History. The same trap silently WEAKENS a
       check instead of failing it whenever the second copy is only read
       from: it answers about a module nothing on screen is using.

       Resolving through the resource timings means we import the exact URL
       the app imported, and throwing when there is no entry means a check
       can never quietly get a private copy instead. The buffer holds 250
       entries by default and the app loads more modules than that, so it is
       raised here — before any of them load. */
    try { performance.setResourceTimingBufferSize(5000); } catch { /* older engines */ }
    window.__scImport = (spec) => {
      const hits = performance.getEntriesByType('resource')
        .map((r) => r.name)
        .filter((n) => { try { return new URL(n).pathname === spec; } catch { return false; } });
      if (!hits.length) {
        throw new Error(
          `__scImport('${spec}'): the app never loaded that module, so importing it `
          + 'here would make a second instance. Open the feature that uses it first.',
        );
      }
      return import(/* @vite-ignore */ hits[hits.length - 1]);  // newest wins after HMR
    };
  });
  await page.goto(VITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ProseMirror', { timeout: 25000 });
  // Startup dialogs (launcher etc.) — dismiss until none within a beat.
  for (let i = 0; i < 5; i++) {
    const overlay = await page.$('.dialog-overlay');
    if (!overlay) break;
    await page.keyboard.press('Escape');
    await settle(page);
  }
  // The DEV editor handle must be up before seedScript can run.
  await page.waitForFunction(() => Boolean(window.__scEditor), { timeout: 10000 });
}

/** Inject a whole script in ONE setContent call — this replaces the per-
 *  keystroke typing loop, which was the single largest cost in every driver.
 *  scenes: [{ heading, lines }] or [{ heading, actions: [...] }]. */
export async function seedScript(page, scenes) {
  await page.evaluate((sc) => {
    const content = [];
    for (const s of sc) {
      content.push({ type: 'sceneHeading', content: [{ type: 'text', text: s.heading }] });
      const actions = s.actions ?? Array.from(
        { length: s.lines ?? 3 },
        (_, i) => `Action line ${i} carrying enough words to occupy some space on the page.`,
      );
      for (const a of actions) content.push({ type: 'action', content: [{ type: 'text', text: a }] });
    }
    window.__scEditor.commands.setContent({ type: 'doc', content });
  }, scenes);
  // Confirm against the EDITOR's own state — the scenes store only rescans
  // while a reader tool is open (SCENES_READERS), so DOM row counts are not
  // a valid readiness signal here. waitScenes() covers that after openTool().
  await page.waitForFunction(
    (n) => {
      let count = 0;
      window.__scEditor?.state.doc.descendants((node) => {
        if (node.type.name === 'sceneHeading') count++;
        return true;
      });
      return count >= n;
    },
    scenes.length,
    { timeout: 10000 },
  );
}

/** Open a tool from the side panel by its label. */
export async function openTool(page, label) {
  const row = await page.$(`.tool-dock-item:has-text("${label}")`);
  if (!row) throw new Error(`no dock row labelled ${label}`);
  await row.click();
  /* .fs-tool-takeover too (v7.70): a tool reopens in the mode it was last used
     in, and the shipped defaults remember four of Derek's tools as fullscreen —
     which is neither an inline header nor a window. */
  await page.waitForSelector('.tool-inline-header, .tool-window, .fs-tool-takeover', { timeout: 8000 });
  return row;
}

/** Back to 100% zoom.
 *
 *  v7.70 made Derek's own preset the app's defaults, and he writes at 140%.
 *  Every check that measures the editor in pixels was measuring his zoom from
 *  that version on — a 30px gap read 42, a 6.3in column read 866px. A check
 *  about a size in px says so by calling this first; one about behaviour does
 *  not need it. */
export async function zoom100(page) {
  await page.evaluate(() => window.__scStore.getState().setZoomLevel(100));
  await settle(page);
}

/** Nothing hidden from the Helper Text window.
 *
 *  v7.70 made Derek's preset the app's defaults, and he has hidden ~200 helper
 *  strings. The window filters those out, so a check that counts rows, opens
 *  the Hidden view, or looks for one particular tooltip was suddenly reading
 *  his housekeeping. A check about the WINDOW says so by calling this; one
 *  about what ships by default does not. */
export async function showAllHelperText(page) {
  await page.evaluate(() => window.__scStore.setState({ helperTextHidden: [], helperTextOverrides: {} }));
  await settle(page);
}

export async function fullscreen(page) {
  /* IDEMPOTENT (v7.70). A tool reopens in its remembered mode, and the shipped
     defaults remember Locations, Scenes, Characters and the Beat Board as
     fullscreen — so the takeover was ALREADY up and this click was toggling
     out of it. The waitForSelector below then timed out on a takeover the
     check had just closed itself. */
  if (await page.$('.fs-tool-takeover')) return;
  await page.click('button[title="Fullscreen"]');
  // .fs-tool-takeover is the generic takeover root (ToolFullscreenTakeover) —
  // the first cut waited on a Scenes-only class and timed out on every other tool.
  await page.waitForSelector('.fs-tool-takeover', { timeout: 8000 });
}

/** A tool that is enabled and present in the dock, whatever the profile says.
 *
 *  v7.70: the shipped defaults are Derek's preset, and his dock leaves six
 *  tools out — Script History, Helper Text, AI Writer, Tags, Workspaces and
 *  Design. A check that drives one of those found no dock row at all. Turn it
 *  on and put it in the order; where it sits by default is not what those
 *  checks are about. */
export async function placeTool(page, id, side = 'right') {
  await page.evaluate(([toolId, toolSide]) => {
    const s = window.__scStore.getState();
    s.setToolConfig({ ...s.toolConfig, [toolId]: { side: toolSide, enabled: true } });
    if (!s.toolOrder.includes(toolId)) s.setToolOrder([...s.toolOrder, toolId]);
  }, [id, side]);
  await settle(page);
}

/** The Scenes tool showing its LIST, not its cards.
 *
 *  v7.70: Scenes remembers which view it was in, and the shipped defaults
 *  (Derek's preset) remember Cards — so `.navigator-scene` rows, which every
 *  scene-list check waits for, were simply not on the page. Call this before
 *  waitScenes when the LIST is the subject. */
export async function useSceneList(page) {
  await page.evaluate(() => window.__scStore.getState().setScenesViewMode('list'));
  await settle(page);
}

/** Wait until the Scenes list has n rows (rescans are debounced). */
export async function waitScenes(page, n) {
  await page.waitForFunction(
    (want) => document.querySelectorAll('.navigator-scene').length >= want,
    n,
    { timeout: 10000 },
  );
}

/** Screenshot an element, clipped, capped height. */
export async function shot(page, selector, path, maxH = 340) {
  const el = await page.$(selector);
  const b = await el?.boundingBox();
  if (!b || b.width < 2 || b.height < 2) { console.log(`(no box for ${selector})`); return; }
  await page.screenshot({ path, clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, maxH) } });
}

// ── gestures (v5.86) ───────────────────────────────────────────────────
// The same handful of interactions were being re-invented in every check,
// each time with its own brittle selector — and the same trap sprung every
// time: a menu left open covers the screen with an invisible backdrop, so the
// NEXT click in the check hits the veil and times out. Three separate checks
// lost time to exactly that in one afternoon. These do it once.

/** Two animation frames — what "the DOM has caught up" actually means.
 *  Replaces waitForTimeout(300) guesses: same certainty, ~30ms not 300. */
export async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const MENUS = '.locmap-menu-veil, .tool-ctl-menu, .locmap-pin-menu, .char-upload-menu, .menu-dropdown';

/** Close whatever is open — menus, their veils, popovers — and prove it. */
export async function dismiss(page) {
  if (!(await page.$(MENUS))) return;
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page);
  if (await page.$(MENUS)) {
    /* NOT a corner click. (4,4) lands on the MENU BAR and opens File —
       a dropdown over whatever the check touches next. A synthetic
       pointerdown reaches the popups' own dismissal paths without
       touching any real control: veil menus close from a press ON the
       veil; usePopup menus close from any capture-phase press outside. */
    await page.evaluate(() => {
      const veil = document.querySelector('.locmap-menu-veil');
      (veil ?? document.body).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }).catch(() => {});
    await settle(page);
  }
  await page.waitForSelector(MENUS, { state: 'detached', timeout: 3000 }).catch(() => {});
  // and if the corner-click of an OLDER check already opened the app menu:
  if (await page.$('.menu-dropdown')) {
    await page.keyboard.press('Escape').catch(() => {});
    await settle(page);
  }
}

/** Open a menu from its trigger, with the screen cleared first. Returns the
 *  menu's item labels, which is what a check almost always wants next. */
export async function openMenu(page, trigger, menuSel = '.locmap-pin-menu') {
  await dismiss(page);
  await page.click(trigger);
  await page.waitForSelector(menuSel);
  await settle(page);
  return page.$$eval(`${menuSel} button, ${menuSel} .tool-ctl-menu-item`,
    (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
}

/** Click an item in the open menu by its exact text. */
export async function menuItem(page, text, menuSel = '.locmap-pin-menu') {
  await page.click(`${menuSel} :text-is("${text}")`);
  await settle(page);
}

/** Expand a Locations sidebar row and wait for its detail. Collapses whatever
 *  was open first — clicking an ALREADY-open row folds it, which is how this
 *  went wrong twice. `match` is a :has() fragment, e.g. '.locmap-rail-badge'. */
export async function expandRailRow(page, match = '') {
  await dismiss(page);
  if (await page.$('.locmap-rail-item-open')) {
    await page.click('.locmap-rail-item-open .locmap-rail-name');
    await settle(page);
  }
  const sel = match ? `.locmap-rail-row:has(${match}) .locmap-rail-name` : '.locmap-rail-row .locmap-rail-name';
  await page.locator(sel).first().click();
  await page.waitForSelector('.locmap-rail-detail');
  await settle(page);
}
