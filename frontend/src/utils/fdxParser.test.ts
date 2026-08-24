// @vitest-environment jsdom
/**
 * FDX import — the .fdx → editor-doc parser and its type resolver. Pairs with the
 * fdxExporter working-notes guard; the round-trip here proves a script survives a
 * Final Draft save-and-reopen without the exporter and parser drifting apart.
 */
import { describe, it, expect } from 'vitest';
import { parseFDXFull, resolveFdxType } from './fdxParser';
import { exportFDX } from './fdxExporter';

interface N { type?: string; content?: { type?: string; text?: string }[] }
const flat = (nodes: N[]) => nodes.map((n) => ({
  type: n.type,
  text: (n.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
}));

describe('resolveFdxType', () => {
  it('maps built-in FDX paragraph types (including aliases)', () => {
    expect(resolveFdxType('Scene Heading')).toEqual({ kind: 'builtin', id: 'sceneHeading' });
    expect(resolveFdxType('Action')).toEqual({ kind: 'builtin', id: 'action' });
    expect(resolveFdxType('Slug')).toEqual({ kind: 'builtin', id: 'sceneHeading' });   // alias
    expect(resolveFdxType('Dialog')).toEqual({ kind: 'builtin', id: 'dialogue' });      // alias
  });

  it('maps known custom types', () => {
    expect(resolveFdxType('Sound Effect')).toEqual({ kind: 'custom', customTypeId: 'soundEffect', customLabel: 'Sound Effect' });
    expect(resolveFdxType('SFX')).toEqual({ kind: 'custom', customTypeId: 'soundEffect', customLabel: 'Sound Effect' });
  });

  it('returns null for an unrecognized type', () => {
    expect(resolveFdxType('Frobnicate')).toBeNull();
  });
});

describe('parseFDXFull', () => {
  it('parses paragraphs and a cast list from FDX XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. DINER - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>Sarah enters.</Text></Paragraph>
    <Paragraph Type="Character"><Text>SARAH</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>We should go.</Text></Paragraph>
  </Content>
  <CastList>
    <CastMember><Name>SARAH</Name><Description>Sharp-eyed, wary.</Description></CastMember>
  </CastList>
</FinalDraft>`;
    const result = parseFDXFull(xml);
    const body = (result.doc.content as N[]).filter((n) => n.type !== 'titlePage');
    expect(flat(body)).toEqual([
      { type: 'sceneHeading', text: 'INT. DINER - DAY' },
      { type: 'action', text: 'Sarah enters.' },
      { type: 'character', text: 'SARAH' },
      { type: 'dialogue', text: 'We should go.' },
    ]);
    expect(result.castList).toEqual([{ name: 'SARAH', description: 'Sharp-eyed, wary.' }]);
  });

  // v7.88 (security review D14): a non-numeric layout attribute must fall back
  // to its default, not slip a NaN into page-layout math (which then blanks the
  // page). `attr || 'default'` only caught the empty case; a garbage value did
  // not. fdxNum guards every numeric read.
  it('falls back to defaults for non-numeric PageLayout attributes — no NaN', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script">
  <Content><Paragraph Type="Action"><Text>x</Text></Paragraph></Content>
  <PageLayout TopMargin="abc" BottomMargin="" HeaderMargin="36" FooterMargin="oops">
    <PageSize Width="not-a-number" Height="11.00"/>
  </PageLayout>
</FinalDraft>`;
    const { pageLayout } = parseFDXFull(xml);
    expect(pageLayout).not.toBeNull();
    // every field stays a finite number — no NaN reached the layout
    for (const [k, v] of Object.entries(pageLayout!)) {
      expect(Number.isFinite(v), `${k} = ${v}`).toBe(true);
    }
    expect(pageLayout!.pageWidth).toBe(8.5);   // "not-a-number" → default
    expect(pageLayout!.topMargin).toBe(90);    // "abc" → default
    expect(pageLayout!.footerMargin).toBe(36); // "oops" → default
    expect(pageLayout!.headerMargin).toBe(36); // valid → kept
    expect(pageLayout!.pageHeight).toBe(11);   // valid → kept
  });
});

describe('FDX round-trip (export → parse)', () => {
  it('recovers the core script elements after a Final Draft save-and-reopen', () => {
    const el = (type: string, text: string) => ({ type, content: [{ type: 'text', text }] });
    const original = [
      el('sceneHeading', 'INT. DINER - DAY'),
      el('action', 'Sarah sips coffee.'),
      el('character', 'SARAH'),
      el('dialogue', 'We should go.'),
      el('transition', 'CUT TO:'),
    ];
    const xml = exportFDX({ type: 'doc', content: original }, 'Test');
    const parsed = parseFDXFull(xml);
    const scriptTypes = new Set(['sceneHeading', 'action', 'character', 'dialogue', 'transition']);
    const body = (parsed.doc.content as N[]).filter((n) => scriptTypes.has(n.type || ''));
    expect(flat(body)).toEqual([
      { type: 'sceneHeading', text: 'INT. DINER - DAY' },
      { type: 'action', text: 'Sarah sips coffee.' },
      { type: 'character', text: 'SARAH' },
      { type: 'dialogue', text: 'We should go.' },
      { type: 'transition', text: 'CUT TO:' },
    ]);
  });
});
