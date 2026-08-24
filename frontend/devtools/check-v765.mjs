/* check-v765 — five rows off the feedback queue.
 *
 *   "move customize from the view menu to format menu"
 *   "i dont understand the Saving & exporting section. how is this different
 *    than the chosen save location in the same window?"
 *   "if no changes have been made to the current workspace, then 'Save changes
 *    to this workspace' and 'reset to saved layout' should be grayed out."
 *   "the coloring of the scale bar for the outline toolbar is backwards…"
 *    (now held by check-v766, which carries his v7.66 correction with it)
 *   "the script craft icon is larger than all other icons in the mac dock"
 *
 * ONE of these is a measurement rather than an assertion about a string, and
 * it is a measurement the eye gets wrong:
 *
 *   The dock icon. "Too big" is exact: macOS lays out icons on the 1024 canvas
 *   and reserves a margin, so artwork drawn edge to edge renders 1024/824 ≈
 *   24% wider than everything beside it. The assertion measures the opaque
 *   bounding box of the icon that actually ships.
 */
import { readFileSync } from 'node:fs';
import { launch, boot, settle } from './driver.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const { browser, page } = await launch({ width: 1500, height: 950 });
await boot(page);
await settle(page);

const openMenu = (label) => page.evaluate(async (l) => {
  document.querySelector('.menu-dropdown')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  document.body.click();
  await new Promise((r) => setTimeout(r, 150));
  [...document.querySelectorAll('.menu-item')].find((m) => m.textContent.trim() === l)?.click();
  await new Promise((r) => setTimeout(r, 400));
  return [...document.querySelectorAll('.menu-dropdown-item')].map((i) => ({
    label: i.textContent.trim(),
    disabled: i.classList.contains('disabled') || i.getAttribute('aria-disabled') === 'true',
  }));
}, label);

/* ── Customize moves menus ───────────────────────────────────────────────── */
console.log('\nCustomize… is in Format, not View');
const viewItems = await openMenu('View');
const formatItems = await openMenu('Format');
ok('the View menu opened at all', viewItems.length > 0, `${viewItems.length} items`);
ok('the Format menu opened at all', formatItems.length > 0, `${formatItems.length} items`);
ok('View no longer offers Customize…',
  !viewItems.some((i) => i.label === 'Customize…'), JSON.stringify(viewItems.map((i) => i.label).slice(0, 6)));
ok('Format offers it now',
  formatItems.some((i) => i.label === 'Customize…'), JSON.stringify(formatItems.map((i) => i.label)));
/* When this was written, Script Format Preferences… was a scoped door that
   had to survive the sweep. v7.81 removed the dialog itself (Derek: "a new
   script will always show all options"), so the assertion flips — the door
   must be GONE, while the Formatting Template one stays. */
ok('…Script Format Preferences is gone with its dialog',
  !formatItems.some((i) => /Script Format Preferences/.test(i.label)),
  JSON.stringify(formatItems.map((i) => i.label)));
ok('…and the Formatting Template door survived',
  formatItems.some((i) => /Formatting Template/.test(i.label)),
  JSON.stringify(formatItems.map((i) => i.label)));

/* ── the two Settings sections that read alike ───────────────────────────── */
console.log('\nthe Settings sections no longer both begin "Sav…"');
const prefsSrc = readFileSync(new URL('../src/components/PreferencesDialog.tsx', import.meta.url), 'utf8');
const headings = [...prefsSrc.matchAll(/<h3>([^<]+)<\/h3>/g)]
  .map((m) => m[1].replace(/&amp;/g, '&').trim())
  .filter((h) => !h.includes('{'));          // one heading is rendered from data
ok('"Script Save Locations" is still there', headings.includes('Script Save Locations'), JSON.stringify(headings));
/* THE assertion. A "no two headings share a first word" rule was tried here
   first and it passed both before AND after the rename — "Saving" and
   "Script" differ — so it could not tell the complaint from the fix. What
   Derek could not distinguish was a DESTINATION from a starting folder, and
   the fix is that one of them now says which it is. */
ok('and the folder-for-dialogs section is named for the windows, not for saving',
  headings.includes('Save As & Export Windows')
  && !headings.some((h) => /^Saving/.test(h)), JSON.stringify(headings));
/* The stored key must NOT have been renamed along with the label — it holds a
   path the user chose, and renaming the key silently resets it. */
ok('…while the stored key keeps its old name',
  /downloadFolder/.test(prefsSrc), '');

/* ── workspace buttons go dead when nothing has moved ────────────────────── */
console.log('\nSave Changes / Reset are dead until something moves');
const wsState = () => page.evaluate(() => {
  const btns = [...document.querySelectorAll('.ws-actions .ws-action-btn')];
  const by = (re) => btns.find((b) => re.test(b.textContent));
  return {
    save: by(/Save Changes/)?.disabled ?? null,
    reset: by(/Reset to Saved/)?.disabled ?? null,
    saveAs: by(/Save as New/)?.disabled ?? null,
  };
});

const fresh = await page.evaluate(async () => {
  const st = window.__scStore.getState();
  /* v7.70: PLACE the tool, don't assume it. The shipped defaults are Derek's
     preset now and his Workspaces tool is disabled, so openTool had nothing to
     open and every button below measured null — a check that reads "not
     enabled" off a control that is not on screen is not testing anything. It
     goes in the RIGHT panel because the probe below toggles the left one. */
  st.setToolConfig({ ...st.toolConfig, workspaces: { side: 'right', enabled: true } });
  await new Promise((r) => setTimeout(r, 200));
  st.openTool('workspaces');
  await new Promise((r) => setTimeout(r, 700));
  st.saveWorkspace('Probe WS');          // saving makes it active AND clean
  await new Promise((r) => setTimeout(r, 400));
  return window.__scStore.getState().activeWorkspace;
});
ok('a workspace is applied', fresh === 'Probe WS', JSON.stringify(fresh));
const clean = await wsState();
ok('Save Changes is disabled while the layout matches', clean.save === true, JSON.stringify(clean));
ok('Reset is disabled too', clean.reset === true, JSON.stringify(clean));
/* Save as New is the one that must stay live — it is how you make the next
   workspace, and it never depends on the current one being dirty. */
ok('…but Save as New Workspace stays available', clean.saveAs === false, JSON.stringify(clean));

await page.evaluate(async () => {
  const st = window.__scStore.getState();
  /* The LEFT panel. Toggling the right one closes the panel these buttons are
     mounted in, so they measure `null` — a check that reads "not enabled"
     from a control that is not on screen is not testing anything. */
  st.toggleNavigator();
  await new Promise((r) => setTimeout(r, 400));
});
const dirty = await wsState();
ok('moving a panel wakes Save Changes', dirty.save === false, JSON.stringify(dirty));
ok('…and Reset', dirty.reset === false, JSON.stringify(dirty));

await page.evaluate(async () => {
  window.__scStore.getState().applyWorkspace('Probe WS');   // put it back
  await new Promise((r) => setTimeout(r, 500));
});
const restored = await wsState();
ok('restoring the layout puts them back to sleep',
  restored.save === true && restored.reset === true, JSON.stringify(restored));

/* The View menu carries the SAME two actions. One dirty test, or the menu and
   the panel will disagree about whether there is anything to save. */
const menuNow = await openMenu('View');
const wsMenu = await page.evaluate(async () => {
  [...document.querySelectorAll('.menu-dropdown-item')]
    .find((i) => i.textContent.trim() === 'Workspaces')?.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  return [...document.querySelectorAll('.menu-dropdown-item')].map((i) => ({
    label: i.textContent.trim(),
    disabled: i.classList.contains('disabled') || i.getAttribute('aria-disabled') === 'true',
  }));
});
/* A parent item's textContent swallows every child's, so its label reads as
   "Workspaces✓ Probe WSSave as New Workspace…" — match the start, not the
   whole string. */
ok('the View menu still reaches Workspaces',
  menuNow.some((i) => i.label.startsWith('Workspaces')),
  JSON.stringify(menuNow.map((i) => i.label.slice(0, 24)).slice(0, 6)));
const menuSave = wsMenu.find((i) => /^Save Changes to this Workspace$/.test(i.label));
const menuReset = wsMenu.find((i) => /^Reset to Saved Layout$/.test(i.label));
ok('…and its Save Changes agrees with the panel (both dead)',
  menuSave?.disabled === true, JSON.stringify(menuSave));
ok('…and its Reset does too', menuReset?.disabled === true, JSON.stringify(menuReset));

/* The dirty test must be built from the SAME capture the save uses. A second
   hand-written field list is how v4.24 happened (save captured three fields
   apply never restored, silently). */
const wsSlice = readFileSync(new URL('../src/stores/slices/workspacesSlice.ts', import.meta.url), 'utf8');
/* v7.65 counted the ONE hand-written copy of the field list. v7.69 removed the
   hand-written list entirely — capture is built from CUSTOMIZATION_FIELDS, the
   list Customize itself reads — so the assertion is now that no copy exists at
   all. check-v769 holds the rest of that arrangement. */
ok('the snapshot has no hand-written field list left',
  !/toolbarHiddenItems:\s*s\.toolbarHiddenItems/.test(wsSlice), '');
ok('…and both save and the dirty test read one capture',
  /saveWorkspace: \(name\) => set\(\(s\) => \{\s*const snap = captureWorkspace\(s\)/.test(wsSlice)
  && /stable\(comparable\(captureWorkspace\(s\)\)\)/.test(wsSlice), '');
/* v7.73: the dirty test now drops the two open-tool fields before comparing
   (Derek: "simply opening a side panel item is considered a change... this
   should not be the case"). It must drop them from BOTH sides — stripping the
   live capture alone would make every workspace permanently dirty against its
   own snapshot, which is the v7.65 complaint with the sign flipped. */
ok('…and the not-a-change fields are dropped from BOTH sides',
  (wsSlice.match(/comparable\(/g) ?? []).length === 2
  && /comparable\(normalizeWorkspace\(saved\)\)/.test(wsSlice), '');

/* ── the outline bar's scale bar ─────────────────────────────────────────
   MOVED to check-v766. Derek corrected this one the next day ("make sure the
   colour fits the color theme"), and the rules changed with it: a thumb built
   from the accent instead of from reading colours, and a groove that may be
   delineated by its lip where a low-contrast palette cannot give a tonal step.
   Two checks asserting overlapping-but-different rules on the same four CSS
   declarations is how one of them ends up quietly wrong. ── */

/* ── the dock icon fits Apple's grid ─────────────────────────────────────── */
console.log('\nthe app icon sits on Apple\'s grid instead of filling the canvas');
const iconBox = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      // Anything meaningfully opaque counts as artwork.
      if (data[(y * c.width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { canvas: c.width, w: maxX - minX + 1, h: maxY - minY + 1, minX, minY };
}, readFileSync(new URL('../../src-tauri/icons/128x128@2x.png', import.meta.url)).toString('base64'));

const frac = iconBox.w / iconBox.canvas;
ok('the shipped icon has real transparent margin',
  iconBox.minX > 0 && iconBox.minY > 0, JSON.stringify(iconBox));
/* 824/1024 = 80.5%. A couple of percent of slack for the resampler's soft
   edge; what must NOT pass is the old 100%, which is the whole complaint. */
ok('…and its artwork is ~80% of the canvas, per Apple\'s grid',
  frac > 0.76 && frac < 0.85, `${(frac * 100).toFixed(1)}%`);
ok('…centred', Math.abs(iconBox.minX - (iconBox.canvas - iconBox.w) / 2) <= 2, JSON.stringify(iconBox));
ok('…and square', Math.abs(iconBox.w - iconBox.h) <= 2, JSON.stringify(iconBox));

/* The .icns is what macOS actually reads, and it is a container the PNGs are
   copied into — regenerating the PNGs without it is the failure that leaves
   the Dock showing the old icon. */
const icns = readFileSync(new URL('../../src-tauri/icons/icon.icns', import.meta.url));
ok('the .icns is well-formed', icns.toString('ascii', 0, 4) === 'icns'
  && icns.readUInt32BE(4) === icns.length, `${icns.readUInt32BE(4)} vs ${icns.length}`);
let off = 8; const sizes = [];
while (off + 8 <= icns.length) {
  const len = icns.readUInt32BE(off + 4);
  if (len < 8 || off + len > icns.length) break;
  const d = icns.subarray(off + 8, off + len);
  if (d.length > 24 && d.readUInt32BE(0) === 0x89504e47) sizes.push(d.readUInt32BE(16));
  off += len;
}
ok('…and carries the full ladder up to 1024', sizes.includes(1024) && sizes.length >= 6, JSON.stringify(sizes));

await browser.close();
console.log(`\ncheck-v765: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
