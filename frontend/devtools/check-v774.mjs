/* check-v774 — the Design and Helper Text windows can each write their own file.
 *
 * Derek: "make it so I can export design and helper text info. these two
 * windows are not going to be part of the release. I will export a file from
 * each for you to integrate into the code directly."
 *
 * So the file is the deliverable, and it has to arrive with everything in it —
 * a button that opens a save dialog and writes half the values would be found
 * out only once those windows were gone and the numbers were wrong in the
 * shipped app.
 *
 * THE FILE IS A PRESET BUNDLE WITH ONE PART, which is what makes it cost
 * nothing: PRESET_PARTS' own collect() is the payload, readPresetFile already
 * understands the shape, and the same file imports straight back through
 * Backup & Restore. This check proves the round trip rather than trusting it.
 *
 * The button is CLICKED, and the download it produces is read back off disk.
 * A source-level assertion that the two windows both render <ExportPartButton>
 * would have passed on a button wired to nothing — the lesson from v7.69's
 * ribbon handle, which rendered, said "move", and did not move anything.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle, placeTool } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch({ width: 1500, height: 950 });
await boot(page);
await settle(page);

/* ── v7.76: there is nothing to export until something is changed ─────────
 * When this check was written the app shipped with 81 design overrides and 141
 * helper-text ones seeded in, so both windows had a payload on first launch.
 * v7.76 moved all of that into the code — "add these settings directly into
 * the app code" — so a fresh profile overrides NOTHING and both buttons are
 * correctly dead. That empty state is now the first thing worth asserting; the
 * export itself is then exercised the way it is actually used, which is after
 * the writer has moved something.
 */
console.log('\nwith nothing changed there is nothing to export, and it says so');
const empty = await page.evaluate(async () => {
  const S = window.__scStore.getState();
  const P = await window.__scImport('/src/utils/presets.ts');
  return {
    design: Object.keys(S.designVars).length,
    overrides: Object.keys(S.helperTextOverrides).length,
    hidden: S.helperTextHidden.length,
    designPart: Object.keys(JSON.parse(P.buildPresetBundle(['design'], '2026-08-22T00:00:00.000Z')).parts.design).length,
  };
});
ok('a fresh profile overrides nothing in either window',
  empty.design === 0 && empty.overrides === 0 && empty.hidden === 0, JSON.stringify(empty));
ok('…so the file the builder would write is empty too', empty.designPart === 0, `${empty.designPart}`);

/* Now make the changes a writer would have made before pressing Export. Three
   kinds, because the helper-text part carries two halves and a file that
   dropped either would still look right from the outside. */
await page.evaluate(async () => {
  const S = window.__scStore.getState();
  S.setDesignVar('editorMainPadTop', 51);
  S.setDesignVar('toolWinRadius', 9);
  S.setHelperTextOverride('Drag to resize', 'MY OWN WORDING');
  S.setHelperTextHidden(['Drag to resize']);
  await new Promise((r) => setTimeout(r, 200));
});
await settle(page);

/* ── the file the builder writes reads back as itself ────────────────────── */
console.log('\na one-part file is a preset file the app can read');
const roundTrip = await page.evaluate(async () => {
  const P = await window.__scImport('/src/utils/presets.ts');
  const S = window.__scStore.getState();
  const out = {};
  for (const id of ['design', 'helpertext']) {
    const text = P.buildPresetBundle([id], '2026-08-22T00:00:00.000Z');
    const doc = JSON.parse(text);
    let read = null, err = null;
    try { read = P.readPresetFile(text); } catch (e) { err = String(e?.message ?? e); }
    out[id] = {
      kind: doc.kind,
      includes: doc.includes,
      parts: Object.keys(doc.parts),
      readIds: read?.ids ?? null,
      err,
      filename: P.typedExportName(P.stampedBase('2026-08-22T00:00:00.000Z'), id),
      payload: doc.parts[id],
    };
  }
  return {
    out,
    liveDesign: Object.keys(S.designVars).length,
    liveOverrides: Object.keys(S.helperTextOverrides).length,
    liveHidden: S.helperTextHidden.length,
  };
});
for (const id of ['design', 'helpertext']) {
  const r = roundTrip.out[id];
  ok(`${id}: the file holds exactly that one part`,
    r.kind === 'preset-bundle' && JSON.stringify(r.includes) === JSON.stringify([id])
    && JSON.stringify(r.parts) === JSON.stringify([id]), JSON.stringify(r.includes));
  /* THE ROUND TRIP. A file the app writes must never be a file the app cannot
     read — presets.ts states that rule in its header, and a brand-new `kind`
     would have broken it silently. */
  ok(`${id}: …and reads back through readPresetFile as that part`,
    r.err === null && JSON.stringify(r.readIds) === JSON.stringify([id]),
    r.err ?? JSON.stringify(r.readIds));
  ok(`${id}: …under a filename that says what it is`,
    r.filename === `scriptcraft-2026-08-22_${id}.json`, r.filename);
}
/* The payload is the LIVE state, not an empty shell. */
ok('design carries every value the app currently holds',
  Object.keys(roundTrip.out.design.payload).length === roundTrip.liveDesign
  && roundTrip.liveDesign > 0,
  `${Object.keys(roundTrip.out.design.payload).length} vs ${roundTrip.liveDesign}`);
ok('…and helper text carries both halves — the edits AND the hidden list',
  Object.keys(roundTrip.out.helpertext.payload.overrides).length === roundTrip.liveOverrides
  && roundTrip.out.helpertext.payload.hidden.length === roundTrip.liveHidden
  && roundTrip.liveHidden > 0,
  JSON.stringify({ o: roundTrip.liveOverrides, h: roundTrip.liveHidden }));

/* ── the buttons, clicked ────────────────────────────────────────────────── */
const grabDownload = async (clickIn) => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.evaluate(clickIn),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, 'utf8') };
};

console.log('\nthe Design window writes one when you press it');
await placeTool(page, 'design', 'right');
const designBtn = await page.evaluate(async () => {
  const S = window.__scStore.getState();
  S.openTool('design');
  await new Promise((r) => setTimeout(r, 800));
  const btn = document.querySelector('.dz-footer .dz-export-btn');
  return { found: Boolean(btn), disabled: btn?.disabled ?? null, title: btn?.title ?? null,
    part: btn?.getAttribute('data-export-part') ?? null };
});
ok('the Design window has an Export button',
  designBtn.found === true && designBtn.part === 'design', JSON.stringify(designBtn));
ok('…live, because there is something to export', designBtn.disabled === false, JSON.stringify(designBtn));
const designFile = await grabDownload(() => {
  document.querySelector('.dz-footer .dz-export-btn')?.click();
});
ok('…and pressing it really writes a file',
  /_design\.json$/.test(designFile.name), designFile.name);
const dParsed = JSON.parse(designFile.text);
ok('…with the design values in it, not an empty shell',
  Object.keys(dParsed.parts?.design ?? {}).length === roundTrip.liveDesign,
  `${Object.keys(dParsed.parts?.design ?? {}).length} values`);

console.log('\nand so does the Helper Text window');
await placeTool(page, 'helpertext', 'right');
const htBtn = await page.evaluate(async () => {
  const S = window.__scStore.getState();
  S.openTool('helpertext');
  await new Promise((r) => setTimeout(r, 900));
  const btn = document.querySelector('.ht-tools .dz-export-btn');
  return {
    found: Boolean(btn),
    part: btn?.getAttribute('data-export-part') ?? null,
    disabled: btn?.disabled ?? null,
    /* Beside Reset, in the actions group — not a second bar of its own. */
    inActionsGroup: Boolean(btn?.closest('.ht-tools-right')),
    /* .ht-tools is space-between; a third direct child would land the reset
       button in the middle of the bar. */
    toolsChildren: document.querySelector('.ht-tools')?.children.length ?? null,
  };
});
ok('the Helper Text window has one too',
  htBtn.found === true && htBtn.part === 'helpertext', JSON.stringify(htBtn));
ok('…live', htBtn.disabled === false, JSON.stringify(htBtn));
ok('…in the actions group beside Reset, not a bar of its own',
  htBtn.inActionsGroup === true && htBtn.toolsChildren === 2, JSON.stringify(htBtn));
const htFile = await grabDownload(() => {
  document.querySelector('.ht-tools .dz-export-btn')?.click();
});
ok('…and it writes its own file', /_helpertext\.json$/.test(htFile.name), htFile.name);
const hParsed = JSON.parse(htFile.text);
/* Read through optional chaining, and say what is missing. A shared button that
   ignored its `part` would put the DESIGN payload in this file, and reading
   straight into .helpertext.overrides crashed the run instead of failing the
   line — which took the two assertions after it down with it. */
ok('…and the file holds the helper text part, not some other one',
  Object.keys(hParsed.parts ?? {}).join() === 'helpertext', JSON.stringify(Object.keys(hParsed.parts ?? {})));
ok('…carrying the edits and the hidden list',
  Object.keys(hParsed.parts?.helpertext?.overrides ?? {}).length === roundTrip.liveOverrides
  && (hParsed.parts?.helpertext?.hidden?.length ?? -1) === roundTrip.liveHidden,
  JSON.stringify({ o: Object.keys(hParsed.parts?.helpertext?.overrides ?? {}).length,
    h: hParsed.parts?.helpertext?.hidden?.length }));
/* Two windows, two different files — compared by their PARTS, not their bytes.
   The bytes always differ: exportedAt is a live timestamp, so a button that
   ignored its `part` and wrote the design payload into both files would still
   pass a text comparison. The parts are the thing that has to differ. */
ok('the two windows wrote DIFFERENT files',
  designFile.name !== htFile.name
  && JSON.stringify(Object.keys(dParsed.parts ?? {})) !== JSON.stringify(Object.keys(hParsed.parts ?? {})),
  JSON.stringify([Object.keys(dParsed.parts ?? {}), Object.keys(hParsed.parts ?? {})]));

/* ── nothing to export is a real state ───────────────────────────────────── */
console.log('\nwith nothing to export the button says so');
const emptyState = await page.evaluate(async () => {
  const S = () => window.__scStore.getState();
  S().setHelperTextOverrides({});
  S().setHelperTextHidden([]);
  await new Promise((r) => setTimeout(r, 400));
  const btn = document.querySelector('.ht-tools .dz-export-btn');
  return {
    disabled: btn?.disabled ?? null,
    title: btn?.title ?? null,
    onScreen: Boolean(document.querySelector('.ht-tools')),
    right: S().activeToolRight,
    foot: [...document.querySelectorAll('.dz-foot-btn')].map((b) => b.textContent.trim()),
  };
});
/* A button that writes an empty file is a button that lies about having done
   something — and this one has to be trustworthy, because the file it makes is
   what the values become once these windows leave the release. */
ok('an empty Helper Text disables the button', emptyState.disabled === true,
  JSON.stringify(emptyState));
ok('…and the tooltip explains why rather than just going grey',
  /nothing to export/i.test(emptyState.title ?? ''), JSON.stringify(emptyState.title));

await browser.close();
console.log(`\ncheck-v774: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
