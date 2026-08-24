/* check-v642 — Derek's local-first batch:
   1 the always-on row shows + edits the device folder (Choose Folder…)
   2 Auto Save Locations has NO "Cloud" row
   3 (engine: local auto saves path gains /Auto Saves/ — asserted on the
     mirrorSnapshot source path string, the UI has no surface for it)
   4 Save Options has NO "ScriptCraft Account" section and NO Cloud row
   5 the System tab is login-free (Reset only)
   6 Settings is a real WINDOW: standard header, drag moves it, resize
     handles present, fullscreen fills the viewport
   7 the Annotations window's button says "Filter" (v6.71 rename; the
     class and data-ctl id are unchanged — they are persisted ids) */
import { launch, boot, seedScript, openTool, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };

try {
  await boot(page);
  await seedScript(page, SCENES_4);

  // ── 6: the Settings WINDOW ──
  await page.evaluate(() => window.__scStore.getState().openPreferences('saveloc'));
  await page.waitForSelector('.prefs-window', { timeout: 8000 });
  const win = await page.evaluate(() => {
    const p = document.querySelector('.prefs-window');
    return {
      header: !!p?.querySelector('.tool-window-header .tool-window-title'),
      fsBtn: !!p?.querySelector('.htw-fsbtn.char-profiles-fullscreen-btn svg'),
      closeBtns: !!p?.querySelector('.tool-window-close svg'),
      resizeZones: [...(p?.querySelectorAll('.fs-edge') ?? [])].length >= 4,
      x: p?.getBoundingClientRect().x,
    };
  });
  ok(win.header && win.fsBtn && win.closeBtns, 'Settings wears the standard window header (title, fullscreen, close)');

  /* v7.06, Derek: Settings now OPENS full screen, and a fullscreen window has
     no resize zones and does not drag — by design. Assert the new default
     first, then shrink to the floating window the next asserts are about. */
  const openedFs = await page.evaluate(() => {
    const r = document.querySelector('.prefs-window').getBoundingClientRect();
    const bar = document.querySelector('.toolbar')?.getBoundingClientRect();
    return { top: Math.round(r.top), barBottom: Math.round(bar?.bottom ?? 0), w: Math.round(r.width) };
  });
  ok(openedFs.w >= 1400 && Math.abs(openedFs.top - openedFs.barBottom) <= 2,
    `Settings opens full screen, seated under the ribbon (top ${openedFs.top} vs ribbon ${openedFs.barBottom})`);
  await page.click('.prefs-window .htw-fsbtn');    // shrink to floating
  await settle(page);
  const zonesNow = await page.evaluate(() =>
    [...document.querySelectorAll('.prefs-window .fs-edge')].length >= 4);
  ok(zonesNow, 'shrunk to a floating window, any-edge resize zones are mounted');
  // drag by the header
  const before = await page.evaluate(() => document.querySelector('.prefs-window').getBoundingClientRect().x);
  const hb = await page.$eval('.prefs-window .tool-window-header', (el) => {
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(hb.x, hb.y);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 40, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  const after = await page.evaluate(() => document.querySelector('.prefs-window').getBoundingClientRect().x);
  ok(Math.abs(after - before - 120) < 8, `dragging the header moves the window (${Math.round(before)} → ${Math.round(after)})`);
  await page.click('.prefs-window .htw-fsbtn');
  await settle(page);
  /* v7.06, Derek: "it covers everything below the ribbon toolbar: both side
     panels and the editing area" — the app BODY, not the whole viewport, so
     the menu bar and ribbon stay visible and reachable. */
  const fs = await page.evaluate(() => {
    const r = document.querySelector('.prefs-window').getBoundingClientRect();
    const bar = document.querySelector('.toolbar')?.getBoundingClientRect();
    const status = document.querySelector('.status-bar')?.getBoundingClientRect();
    return {
      fullWidth: r.width >= window.innerWidth - 1 && r.x === 0,
      underRibbon: !!bar && Math.abs(r.top - bar.bottom) <= 2,
      aboveStatus: !status || r.bottom <= status.top + 2,
      coversMenu: r.top <= 1,
    };
  });
  ok(fs.fullWidth && fs.underRibbon && fs.aboveStatus && !fs.coversMenu,
    'fullscreen fills the app body — under the ribbon, above the status bar, never over the menu bar');
  await page.click('.prefs-window .htw-fsbtn');
  await settle(page);

  // ── 4 + 1 + 2: the Save Options tab ──
  const saveTab = await page.evaluate(() => {
    const w = document.querySelector('.prefs-window');
    const txt = w.textContent || '';
    const rows = [...w.querySelectorAll('#prefs-save-locations .prefs-check-row')].map((r) => r.textContent);
    const alwaysOn = rows.find((t) => t.includes('Local System (always on)')) || '';
    return {
      noAccountSection: ![...w.querySelectorAll('h3')].some((h) => h.textContent.includes('Account')),
      noCloudRow: !txt.includes('Cloud - ScriptCraft Account') && !txt.includes('Cloud — timestamped'),
      alwaysOnHasChooser: alwaysOn.includes('Choose Folder'),
      backupRow: rows.some((t) => t.includes('Local System (backup location)')),
    };
  });
  ok(saveTab.noAccountSection, 'no Account section in Save Options');
  ok(saveTab.noCloudRow, 'no Cloud save or Cloud autosave rows');
  ok(saveTab.alwaysOnHasChooser, 'the always-on row carries Choose Folder…');
  ok(saveTab.backupRow, 'the backup-location row is still there');
  // the always-on chip reflects localSaveFolder — the SAME field Save As
  /* writes through the APP's store instance — __scImport, never a bare
     import(): after any HMR stamp the two are different modules (v7.15). */
  const chip = await page.evaluate(async () => {
    const { useSettingsStore } = await window.__scImport('/src/stores/settingsStore.ts');
    useSettingsStore.getState().setLocalSaveFolder('/tmp/scriptcraft-primary');
    await new Promise((r) => setTimeout(r, 50));
    return document.querySelector('#prefs-save-locations .prefs-check-row code')?.textContent ?? null;
  });
  ok(chip === '/tmp/scriptcraft-primary', `the always-on chip shows the chosen folder (${chip})`);
  await page.evaluate(async () => {
    const { useSettingsStore } = await window.__scImport('/src/stores/settingsStore.ts');
    useSettingsStore.getState().setLocalSaveFolder('');
  });

  // ── 5 → v7.00 (Derek): the System TAB is gone; the sidebar is
  //    categorized System / Page / Customize; Downloads + Languages exist ──
  const rail = await page.evaluate(() => ({
    captions: [...document.querySelectorAll('.prefs-tab-caption')].map((c) => c.textContent.trim()),
    labels: [...document.querySelectorAll('.prefs-tab')].map((t) => t.textContent.trim()),
  }));
  /* v7.11, Derek: "remove the section names for the tabs in the settings
     window." One flat list — captions and dividers gone. */
  ok(rail.captions.length === 0, `the sidebar is one flat list, no section captions (${rail.captions.length})`);
  ok(!rail.labels.includes('System')
      /* v7.14, Derek: "Delete the downloads tab in settings" — its sections
         live at the foot of Save Options now, asserted below. */
      && !rail.labels.includes('Downloads')
      /* v7.06, Derek: the Languages tab is RENAMED Region (it owns units and
         date/time now too), and Editor moved under the Page group. */
      && rail.labels.includes('Region')
      && !rail.labels.includes('Languages')
      /* v7.11: the tab is just "Keyboard", and Presets is a section of
         Defaults rather than a tab of its own. */
      && rail.labels.includes('Keyboard')
      && !rail.labels.includes('Keyboard Shortcuts')
      && !rail.labels.includes('Presets')
      && rail.labels.indexOf('Editor') === rail.labels.indexOf('Page Setup') + 1,
    `System tab gone; no Downloads tab; Region replaces Languages; Editor sits under Page Setup (${rail.labels.slice(0, 8).join(' | ')})`);
  /* v7.14, Derek deleted the Downloads TAB — the download folder and the
     screenshot folder sit at the foot of Save Options, Screenshots last. */
  await page.evaluate(() => {
    [...document.querySelectorAll('.prefs-tab')].find((t) => t.textContent.trim() === 'Save Options')?.click();
  });
  await settle(page);
  ok(await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.prefs-general section > h3')].map((h) => h.textContent);
    /* v7.35: 'Downloads' became 'Saving & Exporting' — nothing here downloads.
       v7.65, Derek: and 'Saving & Exporting' became 'Save As & Export Windows',
       because it was reading as a second save DESTINATION next to Script Save
       Locations when all it sets is the folder those windows open in. */
    return heads.includes('Save As & Export Windows') && heads[heads.length - 1] === 'Screenshots';
  }), 'Save Options holds the save/export folder + Screenshots, last');
  await page.evaluate(() => {
    [...document.querySelectorAll('.prefs-tab')].find((t) => t.textContent.trim() === 'Defaults')?.click();
  });
  await settle(page);
  ok(await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.prefs-general section > h3')].map((h) => h.textContent);
    return heads.includes('Design Window') && heads.includes('Helper Text') && heads.includes('Keyboard Shortcuts')
      && document.querySelectorAll('.fs-defaults-row').length >= 12;
  }), 'Defaults compiles EVERY reset — the window resets included, rows say what they restore');

  // ── v6.99 (Derek, via the feedback form): moved sections, the merged
  //    Page Setup tab, and the Save/Cancel footer ──
  await page.evaluate(() => {
    [...document.querySelectorAll('.prefs-tab')].find((t) => t.textContent.trim() === 'General')?.click();
  });
  await settle(page);
  /* v7.06, Derek: "remove the draft number section from settings > general".
     The v6.99 assert that it LIVES there is inverted rather than deleted. */
  ok(await page.evaluate(() => ![...document.querySelectorAll('.prefs-general section > h3')].some((h) => h.textContent === 'Draft Number')),
    'the Draft Number section is GONE from General');
  ok(await page.evaluate(() => ![...document.querySelectorAll('.prefs-tab')].some((t) => t.textContent.trim() === 'Templates')),
    'the Templates tab is GONE — merged into Page Setup');
  await page.evaluate(() => {
    [...document.querySelectorAll('.prefs-tab')].find((t) => t.textContent.trim() === 'Page Setup')?.click();
  });
  await settle(page);
  /* v7.50: the rows here are TemplateCard now — the same component the Format ▸
     Script Format / Template window uses, at Derek's request. So the selectors
     moved, and two of these assertions got STRONGER rather than looser:

       · a built-in used to be identified by a "Default" chip. It is now
         identified by sitting under the Script Formats heading, and the thing
         actually worth asserting — that you cannot delete one — is read
         straight off the card instead of off a badge that merely claimed it.
       · "New Template…" and its base-picker dropdown are gone: every row
         carries Duplicate, which is the same operation, so what is left is the
         one thing Duplicate cannot do, "+ Create Template" from blank. */
  const pst = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pst-list .template-select-item')];
    const btns = (c) => [...c.querySelectorAll('button')].map((b) => b.textContent.trim());
    // Script Formats runs from its heading to the next one.
    const kids = [...document.querySelector('.pst-list').children];
    const start = kids.findIndex((k) => k.textContent.trim() === 'Script Formats');
    const end = kids.findIndex((k, i) => i > start && k.classList.contains('template-select-category'));
    const builtIns = kids.slice(start + 1, end === -1 ? undefined : end)
      .filter((k) => k.classList.contains('template-select-item'));
    return {
      heads: [...document.querySelectorAll('.fs-dnd-col-head')].map((h) => h.textContent.trim()),
      cards: cards.length,
      builtIns: builtIns.length,
      newBtn: [...document.querySelectorAll('.prefs-window button')].some((b) => b.textContent.trim() === '+ Create Template'),
      deletableDefaults: builtIns.filter((c) => btns(c).includes('Delete')).length,
      editableDefaults: builtIns.filter((c) => btns(c).includes('Edit')).length,
    };
  });
  /* v7.11 put Shown/Hidden columns here; v7.81, Derek: "remove the show/hide
     function for NEW SCRIPT PICKER. a new script will always show all
     options." The columns configured a filter that no longer exists, so the
     assertion flips: the tab is the template LIST, and no Shown/Hidden
     columns render in it. */
  ok(!pst.heads.some((h) => /Shown|Hidden/.test(h)),
    `Page Setup has NO Shown/Hidden columns any more (${pst.heads.join(' | ') || 'none'})`);
  ok(pst.cards >= 6 && pst.builtIns >= 6 && pst.newBtn,
    `six built-in templates listed, plus + Create Template (${pst.cards} cards)`);
  /* The built-ins are immutable CONSTANTS, not rows in templates[] — so
     updateTemplate/deleteTemplate on one is a silent no-op, and offering either
     button would be a control that writes into the void. */
  ok(pst.deletableDefaults === 0 && pst.editableDefaults === 0,
    `no built-in offers Delete or Edit (${pst.deletableDefaults} deletable, ${pst.editableDefaults} editable)`);
  /* v7.12, Derek: View/Edit/Delete live in the LIST above the columns now —
     a column row is a name and its visibility toggle. */
  ok(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.pst-list .template-select-item')];
    return rows.length > 0
      && rows.every((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === 'View'))
      && ![...document.querySelectorAll('.prefs-content button')].some((b) => b.textContent.trim() === 'Apply');
  }), 'every template row has View; the geometry block (and its Apply) left the tab');
  await page.evaluate(() => {
    [...document.querySelectorAll('.pst-list .template-select-item')[0].querySelectorAll('button')].find((b) => b.textContent === 'View')?.click();
  });
  await settle(page);
  /* v7.10, Derek ("make equivalents for the other templates", built-ins
     included): View opens the FULL page of measurement fields for that
     template now, not a seven-row read-only summary. */
  ok(await page.evaluate(() => {
    const d = [...document.querySelectorAll('.dialog-header')].find((h) => /Page Setup$/.test(h.textContent.trim()));
    const fields = document.querySelectorAll('.page-setup-dialog input, .page-setup-dialog select').length;
    return !!d && d.textContent.trim() !== 'Page Setup' && fields >= 12;
  }), "View opens that template's own page of Page Setup fields");
  await page.evaluate(() => {
    [...document.querySelectorAll('.dialog-actions button')].find((b) => /Apply|Close/.test(b.textContent.trim()))?.click();
  });
  await settle(page);
  ok(await page.evaluate(() => {
    const f = document.querySelector('.prefs-footer');
    const labels = [...(f?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim());
    return labels.join(',') === 'Cancel,Save' && f.querySelector('.dialog-btn-primary')?.textContent.trim() === 'Save';
  }), 'the footer holds Cancel + a primary Save, Customize-style');
  await page.click('.prefs-footer button:has-text("Cancel")');
  await settle(page);
  ok(await page.evaluate(() => !document.querySelector('.prefs-window')), 'Cancel closes Settings');

  /* v7.81: with the filter gone the thing to prove is the PICKER ITSELF —
     the real New Script dialog's Format dropdown, with the retired setting
     poisoned the way an old profile would carry it. If anything still read
     enabledScriptFormats, one option would render instead of all of them. */
  const picker = await page.evaluate(async () => {
    const { useSettingsStore } = await window.__scImport('/src/stores/settingsStore.ts');
    const fmt = await window.__scImport('/src/stores/formattingTemplateStore.ts');
    useSettingsStore.setState({ enabledScriptFormats: ['industry-standard'], formatPreferencesInitialized: true });
    return { sys: fmt.SYSTEM_TEMPLATE_LIST.length };
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('.menu-bar-item, .menu-item')].find((m) => m.textContent.trim() === 'File')?.click();
  });
  await page.waitForSelector('.menu-dropdown-item', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    [...document.querySelectorAll('.menu-dropdown-item')].find((i) => /New Script/.test(i.textContent))?.click();
  });
  // The unsaved-changes guard fronts the launcher (the check typed into the
  // script earlier) — Discard, this scratch document is the fixture's.
  await settle(page);
  await page.evaluate(() => {
    const box = [...document.querySelectorAll('.dialog-box, .fs-confirm-box')]
      .find((b) => /Unsaved Changes/i.test(b.textContent ?? ''));
    if (box) [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Discard')?.click();
  });
  await page.waitForSelector('.fs-launcher-choice', { timeout: 5000 }).catch(() => {});
  // The launcher fronts New Script — take the manual door.
  await page.evaluate(() => {
    [...document.querySelectorAll('.fs-launcher-choice')].find((b) => /Manual Setup/.test(b.textContent))?.click();
  });
  await page.waitForSelector('.fs-newscript-format', { timeout: 5000 }).catch(() => {});
  const offered = await page.evaluate(() =>
    document.querySelectorAll('.fs-newscript-format option').length);
  ok(offered >= picker.sys,
    `the New Script Format dropdown offers every system format despite the poisoned filter (${offered} ≥ ${picker.sys})`);
  // close the New Script dialog
  await page.keyboard.press('Escape');
  await settle(page);

  // ── 7: the Annotations button says Filter (v6.71) ──
  await openTool(page, 'Annotations');
  await settle(page);
  const label = await page.evaluate(() => document.querySelector('.markup-ctl-filter .tool-ctl-label')?.textContent);
  ok(label === 'Filter', `the annotations button reads "Filter" (${label})`);
  // and still opens the popover through the unchanged class
  await page.click('.markup-ctl-filter');
  await settle(page);
  ok(await page.$('.markup-filter-pop') !== null, 'clicking it still opens the visibility popover');

  /* ── 3: the local auto save path carries /Auto Saves/ (source-level) ──
     v7.20: the FOLDER is the assertion; the filename is not. It used to pin
     "/Auto Saves/Auto Save — ", which welded this check to a name that said
     the kind twice and called a hand-made snapshot an auto save. The shape of
     the name is pinned properly in saveLocations.mirror.test.ts, against the
     function that builds it. */
  const src = await page.evaluate(async () => (await fetch('/src/services/saveLocations.ts')).text());
  ok(src.includes('/Auto Saves/${'), 'mirrorSnapshot writes into the "Auto Saves" folder');
  ok(!src.includes("snapToCloud"), 'mirrorSnapshot has no Cloud destination left');

  // ── v6.43→v6.95 (Derek, via the feedback form): Settings LEFT File for
  //    Help — directly below About ScriptCraft, a divider on each side. ──
  await page.click('.menu-item:has-text("File")').catch(() => null);
  await settle(page);
  const fileItems = await page.evaluate(() => {
    // the ROOT dropdown only — Script History's hover flyout is a second
    // .menu-dropdown holding its children
    const root = document.querySelector('.menu-dropdown');
    return [...(root?.querySelectorAll(':scope > .menu-dropdown-item') ?? [])]
      .map((el) => el.textContent.trim()).filter(Boolean);
  });
  ok(!fileItems.some((t) => t.startsWith('Settings')) && fileItems[fileItems.length - 1]?.startsWith('Script History'),
    `File no longer holds Settings and ends on Script History (…${JSON.stringify(fileItems.slice(-2))})`);
  await page.keyboard.press('Escape');
  await settle(page);
  for (let i = 0; i < 3; i++) {
    await page.click('.menu-item:has-text("Help")').catch(() => null);
    await settle(page);
    if (await page.evaluate(() => !!document.querySelector('.menu-dropdown'))) break;
  }
  const helpHead = await page.evaluate(() => {
    const root = document.querySelector('.menu-dropdown');
    return [...(root?.children ?? [])].slice(0, 4).map((el) =>
      el.classList.contains('menu-separator') ? '—' : el.textContent.trim());
  });
  ok(helpHead[0]?.startsWith('About ScriptCraft') && helpHead[1] === '—'
      && helpHead[2]?.startsWith('Settings') && helpHead[3] === '—',
    `Help opens About | divider | Settings… | divider (${JSON.stringify(helpHead)})`);
  // the moved door still works, and lands on the REDONE Save Options tab
  await page.evaluate(() => {
    [...document.querySelectorAll('.menu-dropdown .menu-dropdown-item')]
      .find((el) => el.textContent.trim().startsWith('Settings'))?.click();
  });
  await settle(page);
  await page.waitForSelector('.prefs-window', { timeout: 5000 });
  await page.click('.prefs-tab:has-text("Save Options")');
  await settle(page);
  const save = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.prefs-general section > h3')].map((h) => h.textContent.trim());
    const hints = document.querySelectorAll('.prefs-general .prefs-hint').length;
    const sec = document.querySelector('.prefs-general section');
    const h3 = sec?.querySelector('h3');
    const cs = sec ? getComputedStyle(sec) : null;
    const hb = h3 ? getComputedStyle(h3) : null;
    let anc = '', el = sec?.parentElement;
    while (el) {
      const b = getComputedStyle(el).backgroundColor;
      if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { anc = b; break; }
      el = el.parentElement;
    }
    return { heads, hints, border: cs?.borderTopWidth, pos: hb?.position, h3bg: hb?.backgroundColor, anc };
  });
  ok(save.heads.includes('Auto Saves') && !save.heads.includes('Auto Save Locations')
      && !save.heads.includes('Draft Number') && save.heads[save.heads.length - 1] === 'Screenshots',
    `ONE merged Auto Saves; Draft Number gone; Screenshots back, last (v7.14) (${save.heads.join(' | ')})`);
  ok(save.hints === 2, `helper text only under Google Drive + OneDrive (${save.hints} hint blocks)`);
  ok(save.border === '1px' && save.pos === 'static',
    `sections are bordered boxes with the title IN-FLOW inside them (v6.98) (${save.border}/${save.pos})`);
  ok(await page.evaluate(() => {
    const sec = document.querySelector('.prefs-general section');
    const h3 = sec.querySelector('h3');
    return h3.getBoundingClientRect().top - sec.getBoundingClientRect().top > 4;
  }), 'the title sits fully WITHIN the box, not on its edge (v6.98)');
  const btnAlign = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.prefs-general .prefs-check-row .prefs-inline-btn')]
      .filter((b) => b.textContent.includes('Choose Folder'));
    const rights = btns.map((b) => Math.round(b.getBoundingClientRect().right));
    return { n: rights.length, spread: Math.max(...rights) - Math.min(...rights) };
  });
  ok(btnAlign.n >= 3 && btnAlign.spread <= 1,
    `Choose Folder buttons right-align row to row (${btnAlign.n} buttons, spread ${btnAlign.spread}px)`);
  // v6.97, Derek: the box FILLS a shade apart from the window background
  ok(await page.evaluate(() => {
    const sec = document.querySelector('.prefs-general section');
    let el = sec.parentElement, anc = '';
    while (el) {
      const b = getComputedStyle(el).backgroundColor;
      if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { anc = b; break; }
      el = el.parentElement;
    }
    const own = getComputedStyle(sec).backgroundColor;
    return own !== 'rgba(0, 0, 0, 0)' && own !== 'transparent' && own !== anc;
  }), 'and the box FILL differs from the window background (v6.97)');
  await page.evaluate(() => document.querySelector('.prefs-window .tool-window-close')?.click());
  await settle(page);

  // ── the status bar carries no account indicator ──
  const noAuth = await page.evaluate(() => !document.querySelector('.auth-indicator'));
  ok(noAuth, 'no account indicator anywhere in the chrome');
} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v642: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
