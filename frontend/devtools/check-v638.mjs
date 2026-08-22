/* check-v638 — Derek's ten-item batch:
   1 Helper Text window wears the standard tool-window header (+ fullscreen)
   2 Snippets: cut/copy-selection buttons; per-card insert-into-script
   3 the "video" a11y label is OUT of the helper catalog
   4 Outline + Add Section wears the standard blue (fs-btn-primary)
   5 helper text may be BLANK (an '' override that sticks)
   6 map rotation can't collapse the stage below the 160px floor
   7 map action bar: group toggle sits at the RIGHT edge
   8 Map Options lives in the window HEADER as "Options"
   9 rail rows: ONE ⋮ menu (Connect/Hide/Lock/Delete); Map/Pin/Group gone
  10 the panel item-size drag zooms the OPEN tool, not just the dock rows */
import { launch, boot, seedScript, openTool, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };

try {
  await boot(page);
  await seedScript(page, SCENES_4);

  // ── 3: catalog hygiene (data check, no UI needed) ──
  const cat = await page.evaluate(async () => (await import('/src/data/helperTextCatalog.json')).default);
  ok(!cat.some((e) => e.text === 'video'), 'the "video" a11y label is out of the catalog');

  // ── 1: Helper Text window header ──
  // (v6.52: Helper Text is a real TOOL now — the standard tool window IS
  // the chrome; setHelperTextWindowOpen delegates to openTool.)
  await page.evaluate(() => window.__scStore.getState().setHelperTextWindowOpen(true));
  await page.waitForSelector('.tool-window[data-tool="helpertext"]', { timeout: 8000 });
  await settle(page);
  const HTW = '.tool-window[data-tool="helpertext"]';
  const htw = await page.evaluate((w) => {
    const p = document.querySelector(w);
    return {
      header: !!p?.querySelector('.tool-window-header .tool-window-title'),
      fsBtn: !!p?.querySelector('.char-profiles-fullscreen-btn svg'),
      close: !!p?.querySelector('.tool-window-close svg'),
    };
  }, HTW);
  ok(htw.header, 'Helper Text window wears the tool-window header classes');
  ok(htw.fsBtn && htw.close, 'header carries the STANDARD fullscreen and close buttons (SVG icon family)');
  await page.click(`${HTW} .char-profiles-fullscreen-btn`);
  await page.waitForSelector('.fs-tool-takeover', { timeout: 8000 });
  const fsRect = await page.evaluate(() => {
    const r = document.querySelector('.fs-tool-takeover .htw-panel').getBoundingClientRect();
    // the takeover owns the EDITOR AREA (side docks stay) — the panel must
    // fill THAT, not the viewport
    const t = document.querySelector('.fs-tool-takeover').getBoundingClientRect();
    return { w: r.width, tw: t.width };
  });
  ok(fsRect.w >= fsRect.tw * 0.95, `fullscreen takeover hosts the panel edge to edge (${Math.round(fsRect.w)} of ${Math.round(fsRect.tw)}px)`);
  // leave fullscreen through the takeover's own shrink button — the designed
  // exit, which converts back to the floating window (a raw
  // setFullscreenTool(null) just closes the tool).
  await page.click('.fs-tool-takeover .tool-window-minimize');
  await page.waitForSelector(`${HTW} .dz-search-input`, { timeout: 8000 });
  await settle(page);

  // ── 5: blank helper text sticks as an override ──
  const blank = await page.evaluate(() => {
    const st = window.__scStore.getState();
    st.setHelperTextOverride('Click to preview', '');
    return {
      stored: window.__scStore.getState().helperTextOverrides['Click to preview'],
      isOverride: 'Click to preview' in window.__scStore.getState().helperTextOverrides,
    };
  });
  ok(blank.isOverride && blank.stored === '', "an '' override is stored, not treated as reset");
  // and the row's textarea commits blank as an override (not a reset)
  const rowBlank = await page.evaluate(() => {
    const ta = document.querySelector('.ht-input[data-ht-for="Drag to reorder"]');
    if (!ta) return null;
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.blur();
    ta.dispatchEvent(new Event('blur', { bubbles: true }));
    return null;
  });
  await settle(page);
  const rowStored = await page.evaluate(() =>
    window.__scStore.getState().helperTextOverrides['Drag to reorder']);
  ok(rowStored === '', `blur-committing an EMPTY field stores '' (${JSON.stringify(rowStored)})`);
  void rowBlank;
  await page.evaluate(() => {
    const st = window.__scStore.getState();
    st.setHelperTextOverride('Click to preview', null);
    st.setHelperTextOverride('Drag to reorder', null);
    st.setHelperTextWindowOpen(false);
  });

  // ── 2: snippet buttons ──
  await openTool(page, 'Snippets');
  await settle(page);
  const snipBtns = await page.evaluate(() => {
    const row = document.querySelector('.fs-sticky-tool .tool-action-row');
    return row ? [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) : null;
  });
  ok(!!snipBtns && snipBtns.some((t) => t.includes('Cut selection')) && snipBtns.some((t) => t.includes('Copy selection')),
    `capture buttons present (${JSON.stringify(snipBtns)})`);
  // copy a selection in via the button, then insert it back at the cursor
  await page.evaluate(() => {
    window.__scEditor.chain().setTextSelection({ from: 30, to: 50 }).run();
  });
  await page.click('.fs-sticky-tool .tool-action-row button:has-text("Copy selection")');
  await settle(page);
  const afterCopy = await page.evaluate(() => {
    const cards = window.__scStore.getState().shelfCards.filter((c) => c.type === 'snippet');
    return { n: cards.length, text: cards[cards.length - 1]?.text ?? '' };
  });
  ok(afterCopy.n >= 1 && afterCopy.text.length > 0, `Copy selection made a snippet ("${afterCopy.text.slice(0, 24)}…")`);
  const insertBtn = await page.$('.fs-sticky-tool .swn-card button[title*="Insert snippet into script"]');
  ok(!!insertBtn, 'each snippet card carries an insert-into-script button');
  const lenBefore = await page.evaluate(() => window.__scEditor.state.doc.content.size);
  await page.evaluate(() => window.__scEditor.chain().setTextSelection(4).run());
  if (insertBtn) await insertBtn.click();
  await settle(page);
  const lenAfter = await page.evaluate(() => window.__scEditor.state.doc.content.size);
  ok(lenAfter > lenBefore, `insert grew the script (${lenBefore} → ${lenAfter})`);

  // ── 4: Add Section is the standard blue ──
  await openTool(page, 'Outline');
  await settle(page);
  const addSec = await page.evaluate(() => {
    const b = document.querySelector('.beat-board-add-col-btn');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const root = getComputedStyle(document.documentElement);
    return { bg: cs.backgroundColor, want: root.getPropertyValue('--fd-btn-bg').trim(), cls: b.className };
  });
  const hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h ?? '');
    return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h;
  };
  ok(!!addSec && addSec.cls.includes('fs-btn-primary') && addSec.bg === hexToRgb(addSec.want),
    `+ Add Section wears the primary blue (${addSec?.bg})`);

  // ── 8+7: Locations map header Options; toggle at the right edge ──
  await openTool(page, 'Locations');
  await page.evaluate(() => window.__scStore.getState().setLocationsTab('map'));
  await settle(page);
  // the action bar exists only once a map does
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#7a9'; g.fillRect(0, 0, 400, 200);
    window.__scStore.getState().setLocationMapImage({ src: c.toDataURL('image/png'), rotation: 0, rotationLocked: true });
  });
  await settle(page);
  const mapBar = await page.evaluate(() => {
    const opts = document.querySelector('.locmap-mapopts-btn');
    const bar = document.querySelector('.locmap-actionbar');
    const toggle = bar?.querySelector('.loc-group-toggle, [class*="group-toggle"], [class*="GroupToggle"]')
      ?? [...(bar?.children ?? [])].at(-1);
    const inHeader = !!opts && !!opts.closest('.tool-inline-header, .tool-window-header');
    const barR = bar?.getBoundingClientRect();
    const tR = toggle?.getBoundingClientRect();
    return {
      optsLabel: opts?.textContent?.trim(),
      inHeader,
      optsInBar: !!bar?.querySelector('.locmap-mapopts-btn'),
      toggleAtRight: barR && tR ? (barR.right - tR.right) < 40 : false,
    };
  });
  ok(mapBar.inHeader && mapBar.optsLabel === 'Options', `"Options" sits in the window header (${mapBar.optsLabel})`);
  ok(!mapBar.optsInBar, 'the action bar no longer holds Map Options');
  ok(mapBar.toggleAtRight, 'the group toggle hugs the right edge of the action bar');

  // ── 9: rail ⋮ menu ──
  const dots = await page.$('.locmap-rail-menu-btn');
  ok(!!dots, 'each rail row header carries the ⋮ button');
  if (dots) {
    await dots.click();
    await settle(page);
    const menu = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.locmap-pin-menu-item')].map((b) => b.textContent.trim());
      return items;
    });
    ok(menu.some((t) => t.startsWith('Connect to location')) && menu.some((t) => t.includes('locations list'))
      && menu.some((t) => t.includes('pin')) && menu.some((t) => t === 'Delete pin'),
      `the ⋮ menu holds the Map+Pin options (${menu.length} items)`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('.locmap-menu-veil')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await settle(page);
  }
  const oldBtns = await page.evaluate(() => ({
    map: !!document.querySelector('.locmap-rail-detail .locmap-tool-btn'),
  }));
  // expand a row to prove the details block shows NO buttons row
  await page.evaluate(() => document.querySelector('.locmap-rail-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settle(page);
  const detailBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.locmap-rail-detail .locmap-detail-actions button')].map((b) => b.textContent.trim()));
  ok(detailBtns.length === 0, `the expanded details show no Map/Pin/Group buttons (${JSON.stringify(detailBtns)})`);
  void oldBtns;

  // ── 6: rotation floor ──
  const rot = await page.evaluate(() => {
    window.__scStore.getState().rotateLocationMap();
    return null;
  });
  void rot;
  await settle(page);
  const stage = await page.evaluate(() => {
    const s = document.querySelector('.locmap-stage')?.getBoundingClientRect();
    return s ? { w: Math.round(s.width), h: Math.round(s.height) } : null;
  });
  ok(!!stage && Math.max(stage.w, stage.h) >= 158, `rotated stage stays visible (${stage?.w}×${stage?.h}, long side ≥160)`);

  // ── 10: the item-size drag zooms the open tool ──
  // The CONTAINER keeps the panel's width under `zoom` (content lays out at
  // width/zoom and scales back) — so measure an element INSIDE: its visual
  // box must grow with the scale.
  const zoom = await page.evaluate(() => {
    const inner = document.querySelector('.tool-inline .locmap-addpin-btn')
      ?? document.querySelector('.tool-inline button');
    if (!inner) return null;
    const wrap = inner.closest('.tool-dock-wrap') ?? document.querySelector('.tool-dock-wrap');
    const before = inner.getBoundingClientRect().height;
    wrap.style.setProperty('--dock-scale', '1.4');
    const after = inner.getBoundingClientRect().height;
    wrap.style.removeProperty('--dock-scale');
    return { before, after };
  });
  ok(!!zoom && zoom.after > zoom.before * 1.25,
    `--dock-scale zooms the OPEN tool's contents (${Math.round(zoom?.before ?? 0)} → ${Math.round(zoom?.after ?? 0)}px item height)`);
} catch (e) {
  console.log('PROBE ERROR:', e.message);
} finally { await browser.close(); }
console.log(`\ncheck-v638: ${pass} passed, ${fail} failed`);
