/* check-v665 — Derek, on seeing v6.64: "it adds them to the script in the
   old section format instead of as an annotation like I requested."

   v6.64 read "annotation" as the `# …` section LINE. He meant the app's
   ANNOTATIONS. So Send to Script now makes real annotations, anchored at the
   section's page, that mirror their section.

   1 the button makes ANNOTATIONS — nothing is written into the script text
   2 each one is anchored to the element at its section's page
   3 it reads "<name> — <n> pages", with no "# "
   4 renaming the section rewrites the annotation — on the spot
   5 changing the page estimate rewrites it too
   6 it mirrors with the Outline Bar CLOSED (renames happen on the board)
   7 sending again updates instead of duplicating
   8 two sections that resolve to the same spot don't evict each other
   9 a hand-made annotation is never rewritten by the mirror
  10 deleting the section leaves its annotation alone
  11 the v6.64 `# …` lines are cleared out on the next send */
import { launch, boot, seedScript, SCENES_4, settle } from './driver.mjs';

const { browser, page } = await launch({ width: 1500, height: 950 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };

/** The annotations the outline sent, with the text they show. */
const sent = () => page.evaluate(() => {
  const text = (c) => {
    const parts = [];
    const walk = (x) => {
      if (!x || typeof x !== 'object') return;
      if (x.type === 'text' && x.text) parts.push(x.text);
      (x.content || []).forEach(walk);
    };
    walk(c);
    return parts.join('').trim();
  };
  return window.__scStore.getState().markups
    .filter((m) => m.outlineSectionId)
    .map((m) => ({ id: m.id, section: m.outlineSectionId, text: text(m.content), icon: m.icon }));
});
const forSection = async (id) => (await sent()).find((m) => m.section === id);
/** Where each annotation is anchored in the document. */
const anchors = () => page.evaluate(() => {
  const out = {};
  window.__scEditor.state.doc.forEach((node, pos) => {
    if (node.attrs?.markupId) out[node.attrs.markupId] = { pos, type: node.type.name };
  });
  return out;
});

try {
  await boot(page);
  await seedScript(page, SCENES_4);
  await page.evaluate(() => window.__scStore.getState().setOutlineBarOpen(true));
  await page.waitForSelector('.fs-ob-main', { timeout: 8000 });
  const ids = await page.evaluate(() => {
    const st = window.__scStore.getState();
    st.setBeatColumns([]); st.setBeats([]); st.setMarkups([]);
    const a = st.addBeatColumn('Act I', 4);
    const b = st.addBeatColumn('Act II', 8);
    st.addBeat('Opening', a);
    return { a, b };
  });
  await page.waitForSelector('.fs-ob-scenes .fs-ob-scene', { timeout: 8000 });
  await settle(page);
  const textBefore = await page.evaluate(() => window.__scEditor.state.doc.textContent);

  /* ── 1–3: send ── */
  await page.click('button[title^="Add all sections to the script"]');
  await page.waitForSelector('.fs-confirm-overlay', { timeout: 5000 });
  const prompt = await page.evaluate(() => document.querySelector('.fs-confirm-box')?.textContent ?? '');
  ok(/annotations/.test(prompt) && !/section lines/.test(prompt),
    `the confirm says annotations, not section lines ("${prompt.slice(14, 74)}…")`);
  await page.click('.fs-confirm-ok');
  await settle(page);

  const made = await sent();
  ok(made.length === 2, `one ANNOTATION per section (${made.length})`);
  const textAfter = await page.evaluate(() => window.__scEditor.state.doc.textContent);
  ok(textAfter === textBefore, 'and not one character was written into the script itself');
  const a1 = await forSection(ids.a);
  ok(a1.text === 'Act I — 4 pages', `it reads name and pages (“${a1.text}”)`);
  ok(!a1.text.includes('#'), 'with no "# " — it is an annotation, not a section line');
  const anch = await anchors();
  ok(!!anch[a1.id], `it is anchored to an element in the script (${anch[a1.id]?.type})`);
  const a2 = await forSection(ids.b);
  ok(anch[a1.id].pos < anch[a2.id].pos,
    `Act I's annotation sits before Act II's (${anch[a1.id].pos} < ${anch[a2.id].pos})`);
  ok(anch[a1.id].pos === 0, `Act I starts on page 1, so it anchors at the top (${anch[a1.id].pos})`);

  /* ── 4–5: the mirror ── */
  await page.evaluate((id) => window.__scStore.getState().updateBeatColumn(id, { title: 'Act One' }), ids.a);
  await settle(page);
  ok((await forSection(ids.a)).text === 'Act One — 4 pages', `renaming rewrote it (${(await forSection(ids.a)).text})`);
  await page.evaluate((id) => window.__scStore.getState().updateBeatColumn(id, { targetPages: 12 }), ids.a);
  await settle(page);
  ok((await forSection(ids.a)).text === 'Act One — 12 pages', 'changing the estimate rewrote it too');
  ok((await forSection(ids.b)).text === 'Act II — 8 pages', 'and the other section was left alone');

  /* ── 6: with the bar CLOSED ── */
  await page.evaluate(() => window.__scStore.getState().setOutlineBarOpen(false));
  await settle(page);
  await page.evaluate((id) => window.__scStore.getState().updateBeatColumn(id, { title: 'Act I Revised', targetPages: 20 }), ids.a);
  await settle(page);
  ok((await forSection(ids.a)).text === 'Act I Revised — 20 pages',
    `it mirrors with the Outline Bar closed (${(await forSection(ids.a)).text})`);
  await page.evaluate(() => window.__scStore.getState().setOutlineBarOpen(true));
  await settle(page);

  /* ── 7–8: send again, with sections whose pages run past the script ── */
  await page.evaluate(() => {
    const st = window.__scStore.getState();
    st.addBeatColumn('Act III', 6);
    st.addBeatColumn('Act IV', 6);
  });
  await settle(page);
  await page.click('button[title^="Add all sections to the script"]');
  await page.waitForSelector('.fs-confirm-overlay', { timeout: 5000 });
  await page.click('.fs-confirm-ok');
  await settle(page);
  const after = await sent();
  ok(after.length === 4, `sending again added only what was missing — no duplicates (${after.length})`);
  const anch2 = await anchors();
  const spots = after.map((m) => anch2[m.id]?.pos);
  ok(new Set(spots).size === spots.length && spots.every((p) => p !== undefined),
    `every annotation has its OWN anchor — none evicted another (${spots.join(', ')})`);

  /* ── 9: a hand-made annotation is not the mirror's business ── */
  const handId = await page.evaluate(() => {
    const st = window.__scStore.getState();
    const id = 'hand-made-1';
    st.addMarkup({
      id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'my own note' }] }] },
      icon: 'flag', color: '#e05555', highlight: null, anchor: 'point', done: false, createdAt: new Date().toISOString(),
    });
    return id;
  });
  await page.evaluate((id) => window.__scStore.getState().updateBeatColumn(id, { title: 'Changed Again' }), ids.a);
  await settle(page);
  const hand = await page.evaluate((id) => {
    const m = window.__scStore.getState().markups.find((x) => x.id === id);
    return m.content.content[0].content[0].text;
  }, handId);
  ok(hand === 'my own note', `a hand-made annotation is never rewritten (“${hand}”)`);

  /* ── 10: deleting the section ── */
  const before = (await sent()).length;
  await page.evaluate((id) => window.__scStore.getState().deleteBeatColumn(id), ids.b);
  await settle(page);
  const kept = await sent();
  ok(kept.length === before && (await forSection(ids.b))?.text === 'Act II — 8 pages',
    `deleting the section leaves its annotation exactly as it was (${kept.length} of ${before})`);

  /* ── 11: v6.64's leftover "# …" lines are swept on the next send ── */
  await page.evaluate(() => {
    const ed = window.__scEditor;
    const node = ed.state.schema.nodes.general.create(
      { outlineSectionId: 'stale-v664' },
      ed.state.schema.text('# Section 1 — 1 page'),
    );
    ed.view.dispatch(ed.state.tr.insert(0, node));
  });
  await settle(page);
  ok((await page.evaluate(() => window.__scEditor.state.doc.textContent)).includes('# Section 1'),
    'a v6.64 line is in the script to start with');
  await page.click('button[title^="Add all sections to the script"]');
  await page.waitForSelector('.fs-confirm-overlay', { timeout: 5000 });
  await page.click('.fs-confirm-ok');
  await settle(page);
  const swept = await page.evaluate(() => window.__scEditor.state.doc.textContent);
  ok(!swept.includes('# Section 1'), 'and the next send clears it out');
  ok(swept === textBefore, 'leaving the script exactly as the writer wrote it');

  /* ── v6.66, Derek: "each section is 1 page, so section 1 should be at the
     top of page 1, the next at the top of page 2, etc. But … that is not
     where the section annotations were placed."
     v6.65 mapped a page to the SCENE covering it — the Outline Bar's own
     estimate — so a 1-page section landed wherever its scene began. Ground
     truth here is the PAGINATOR's: it pushes each page's first element down
     with a big inline margin-top, so those elements are the page tops. ── */
  const onePagers = await page.evaluate(() => {
    const st = window.__scStore.getState();
    st.setBeatColumns([]); st.setMarkups([]);
    return ['Page One', 'Page Two', 'Page Three'].map((t) => st.addBeatColumn(t, 1));
  });
  await settle(page);
  await page.click('button[title^="Add all sections to the script"]');
  await page.waitForSelector('.fs-confirm-overlay', { timeout: 5000 });
  await page.click('.fs-confirm-ok');
  await settle(page);
  const placed = await page.evaluate((ids) => {
    const st = window.__scStore.getState();
    const kids = [...document.querySelectorAll('.ProseMirror > *')];
    // element 0 opens page 1; every later page starts at the element the
    // paginator pushed down
    const tops = kids.map((el, i) => ({ i, mt: parseFloat(el.style.marginTop || '0') }))
      .filter((x) => x.i === 0 || x.mt > 20)
      .map((x) => x.i);
    const anchorIdx = (mkId) => kids.findIndex((el) => el.getAttribute('data-markup-block') === mkId);
    return {
      pages: tops.length,
      rows: ids.map((secId) => {
        const m = st.markups.find((x) => x.outlineSectionId === secId);
        const idx = m ? anchorIdx(m.id) : -1;
        return { idx, atTopOfPage: tops.indexOf(idx) + 1 };
      }),
    };
  }, onePagers);
  ok(placed.pages >= 3, `the seeded script really is more than 3 pages long (${placed.pages})`);
  placed.rows.forEach((r, i) => {
    ok(r.atTopOfPage === i + 1,
      `the 1-page section ${i + 1} anchors at the TOP OF PAGE ${i + 1} (element ${r.idx}${r.atTopOfPage ? `, top of page ${r.atTopOfPage}` : ', not a page top'})`);
  });

} catch (e) {
  console.log('PROBE ERROR:', e.message);
  fail++;
} finally { await browser.close(); }
console.log(`\ncheck-v665: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
