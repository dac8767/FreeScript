// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DESIGN_GROUPS,
  DESIGN_TOKENS,
  applyDesignVars,
  buildOverrideCss,
  clampDesignVars,
  clampTokenValue,
  designToken,
} from './designTokens';
import { useEditorStore } from '../stores/editorStore';

// Concatenate every screenplay stylesheet once — the source of truth for what
// the running app actually consumes.
const STYLES_DIR = join(__dirname, '..', 'styles', 'screenplay');
const ALL_CSS = readdirSync(STYLES_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(STYLES_DIR, f), 'utf8'))
  .join('\n');

const CSS_TOKENS = DESIGN_TOKENS.filter((t) => t.cssVar);
const STORE_TOKENS = DESIGN_TOKENS.filter((t) => t.store);

describe('design token registry', () => {
  it('every token is exactly one kind — css-var or store-bound', () => {
    for (const t of DESIGN_TOKENS) {
      expect(Boolean(t.cssVar) !== Boolean(t.store), `${t.id} must be css-var xor store`).toBe(true);
    }
  });

  it('has unique ids and unique css vars', () => {
    const ids = DESIGN_TOKENS.map((t) => t.id);
    const vars = CSS_TOKENS.map((t) => t.cssVar);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it('every default sits within its slider range', () => {
    for (const t of DESIGN_TOKENS) {
      expect(t.def, t.id).toBeGreaterThanOrEqual(t.min);
      expect(t.def, t.id).toBeLessThanOrEqual(t.max);
      expect(t.max, t.id).toBeGreaterThan(t.min);
    }
  });

  // The whole point of the panel: NO dead knobs. Each css-var token's variable
  // must actually be read via var(--x, …), or moving its slider does nothing —
  // the silent no-op this project treats as a cardinal sin. (Store-bound tokens
  // drive a store field instead, checked below.)
  it('every css-var token is consumed by the stylesheet (no dead knobs)', () => {
    const dead = CSS_TOKENS.filter((t) => !ALL_CSS.includes(`var(${t.cssVar}`));
    expect(dead.map((t) => `${t.id} → ${t.cssVar}`)).toEqual([]);
  });

  it('every store-bound token has get and set', () => {
    for (const t of STORE_TOKENS) {
      expect(typeof t.store!.get, t.id).toBe('function');
      expect(typeof t.store!.set, t.id).toBe('function');
    }
  });

  // At least one --dz-* usage must fall back to the declared default, or the
  // knob's reset target is a value the CSS never actually renders. (A token can
  // be read in several rules — a base rule and a mode-specific one — with
  // different fallbacks; the default must match the mode the def represents.)
  it('--dz-* defaults are a real fallback somewhere in the CSS', () => {
    for (const t of CSS_TOKENS) {
      if (!t.cssVar!.startsWith('--dz-')) continue;
      if (t.choices) {
        // v4.71: choice tokens fall back to a KEYWORD — it must be the css of
        // the default choice, or reset renders something the knob never shows.
        const defCss = t.choices.find((c) => c.value === t.def)!.css;
        const re = new RegExp(`var\\(${t.cssVar},\\s*([a-z-]+)\\)`, 'g');
        const fallbacks = [...ALL_CSS.matchAll(re)].map((m) => m[1]);
        expect(fallbacks.length, `${t.id} has no var() usage with a keyword fallback`).toBeGreaterThan(0);
        expect(fallbacks, `${t.id} default '${defCss}' is not a fallback anywhere`).toContain(defCss);
        continue;
      }
      /* v7.76: the minus is part of the number. Derek's Design values are the
         app's defaults now and three ribbon gaps are NEGATIVE (-1, -2, -3 —
         rows that overlap by a pixel), which this pattern could not see at all:
         it reported "no var() usage with a numeric fallback" for a token whose
         fallback was right there, reading -2px. */
      const re = new RegExp(`var\\(${t.cssVar},\\s*(-?[0-9.]+)(px|in|pt)?\\)`, 'g');
      const fallbacks = [...ALL_CSS.matchAll(re)].map((m) => parseFloat(m[1]));
      expect(fallbacks.length, `${t.id} has no var() usage with a numeric fallback`).toBeGreaterThan(0);
      expect(fallbacks, `${t.id} default ${t.def} is not a fallback anywhere`).toContain(t.def);
    }
  });

  // v4.71: the choice mechanism itself — the mirror writes the option's css
  // keyword, and Copy CSS dumps the same thing.
  it('choice tokens format as their css keyword', () => {
    const align = designToken('ribTitleAlign')!;
    applyDesignVars({ ribTitleAlign: 0 });
    expect(document.documentElement.style.getPropertyValue('--dz-rib-title-align')).toBe('left');
    expect(buildOverrideCss({ ribTitleAlign: 2 })).toContain('--dz-rib-title-align: right;');
    applyDesignVars({});
    expect(align.choices!.map((c) => c.value)).toEqual([0, 1, 2]);
  });
});

describe('applyDesignVars', () => {
  afterEach(() => {
    for (const t of CSS_TOKENS) document.documentElement.style.removeProperty(t.cssVar!);
  });

  it('sets overridden tokens and clears the rest', () => {
    applyDesignVars({ editorMainPadTop: 48, toolbarBtnRadius: 8 });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--dz-editor-main-pad-top')).toBe('48px');
    expect(root.style.getPropertyValue('--dz-toolbar-btn-radius')).toBe('8px');
    // an untouched token leaves no inline property (CSS default wins)
    expect(root.style.getPropertyValue('--dz-dialog-radius')).toBe('');
  });

  it('clears a property when its override is removed', () => {
    applyDesignVars({ dialogRadius: 12 });
    expect(document.documentElement.style.getPropertyValue('--dz-dialog-radius')).toBe('12px');
    applyDesignVars({});
    expect(document.documentElement.style.getPropertyValue('--dz-dialog-radius')).toBe('');
  });

  it('never writes a :root property for a store-bound token', () => {
    applyDesignVars({ menuSpacing: 8, toolbarSpacing: 6 });
    expect(document.documentElement.getAttribute('style') || '').not.toContain('undefined');
  });

  it('ignores unknown keys', () => {
    applyDesignVars({ notAToken: 5 } as unknown as Record<string, number>);
    expect(document.documentElement.getAttribute('style') || '').not.toContain('notAToken');
  });

  /* v7.32 — THE 400px VOID. Derek: "there is a giant gap above the top page",
     on every saved file, unchanged by resizing the window. Measured in the
     browser: `editorMainPadTop: 400` paints exactly that, and the slider that
     owns the value stops at 120 — so nothing on screen could undo it. The
     panel clamped on commit and nowhere else, and designVars is a PERSISTED
     map that rides in presets and settings backups. It is not a
     paranoia guard: it is the one door a number that never came from the
     panel walks through. */
  it('holds an out-of-range stored value to the range its slider can reach', () => {
    applyDesignVars({ editorMainPadTop: 400 });
    expect(document.documentElement.style.getPropertyValue('--dz-editor-main-pad-top')).toBe('120px');
    applyDesignVars({ editorMainPadTop: -50 });
    expect(document.documentElement.style.getPropertyValue('--dz-editor-main-pad-top')).toBe('0px');
  });

  it('leaves an in-range value exactly as stored', () => {
    applyDesignVars({ editorMainPadTop: 48 });
    expect(document.documentElement.style.getPropertyValue('--dz-editor-main-pad-top')).toBe('48px');
  });
});

describe('clampDesignVars', () => {
  it('clamps every known token to its own min/max', () => {
    const out = clampDesignVars({ editorMainPadTop: 400, dialogRadius: -9 });
    expect(out.editorMainPadTop).toBe(designToken('editorMainPadTop')!.max);
    expect(out.dialogRadius).toBe(designToken('dialogRadius')!.min);
  });

  it('passes unknown ids through untouched — migration keys must survive', () => {
    // toolWinHeaderPad is a RETIRED key migrateDesignVars still splits; clamping
    // must not eat it before the migration runs.
    const out = clampDesignVars({ toolWinHeaderPad: 9, notAToken: 5 });
    expect(out.toolWinHeaderPad).toBe(9);
    expect(out.notAToken).toBe(5);
  });

  it('returns the SAME object when nothing was out of range', () => {
    // identity, not just equality — an in-range map must not churn a new
    // reference through the store on every read.
    const input = { editorMainPadTop: 48 };
    expect(clampDesignVars(input)).toBe(input);
  });

  it('does not mutate its input', () => {
    const input = { editorMainPadTop: 400 };
    clampDesignVars(input);
    expect(input.editorMainPadTop).toBe(400);
  });

  it('every token clamps within its own declared bounds', () => {
    for (const t of DESIGN_TOKENS) {
      expect(clampTokenValue(t, t.max + 1000)).toBe(t.max);
      expect(clampTokenValue(t, t.min - 1000)).toBe(t.min);
      expect(clampTokenValue(t, t.def)).toBe(t.def);
    }
  });
});

describe('buildOverrideCss', () => {
  it('returns empty string with no overrides', () => {
    expect(buildOverrideCss({})).toBe('');
  });

  it('emits only css-var tokens that differ from their default', () => {
    // toolbarSpacing is store-bound → never in the CSS dump; toolbarBtnRadius at
    // its default is skipped; dialogRadius override is emitted.
    const css = buildOverrideCss({ dialogRadius: 12, toolbarBtnRadius: 5 /* == default */, toolbarSpacing: 10 });
    expect(css).toContain('--dz-dialog-radius: 12px;');
    expect(css).not.toContain('--dz-toolbar-btn-radius');
    expect(css).not.toContain('toolbarSpacing');
    expect(css.startsWith(':root {')).toBe(true);
  });

  it('formats px overrides in the :root block', () => {
    const css = buildOverrideCss({ editorMainPadTop: 48, dialogRadius: 12 });
    expect(css).toContain('--dz-editor-main-pad-top: 48px;');
    expect(css).toContain('--dz-dialog-radius: 12px;');
  });
});

describe('groups', () => {
  it('flattened tokens equal the sum of group tokens', () => {
    const summed = DESIGN_GROUPS.reduce((n, g) => n + g.tokens.length, 0);
    expect(DESIGN_TOKENS.length).toBe(summed);
  });
});

// v6.93/v6.94: the Feedback group — Derek's spacing knobs for the form. The
// generic suites above pin consumption + fallback==default; this pins the set
// (fbHelpGap left with the ? in v6.94).
describe('feedback group', () => {
  it('exists and carries the thirteen spacing knobs', () => {
    const g = DESIGN_GROUPS.find((x) => x.id === 'feedback');
    expect(g!.tokens.map((t) => t.id)).toEqual([
      'fbNameGap', 'fbEditGap', 'fbTypeGap', 'fbDescGap', 'fbHeadGap',
      'fbBtnGap', 'fbHeadRowGap', 'fbAttachGap', 'fbRowGap', 'fbSubmitGap',
      'fbPadSide', 'fbPadTop', 'fbPadBottom',
    ]);
  });
});

// v6.97/v6.98: the Settings Window group — the section-box spacing knobs.
describe('settings window group', () => {
  it('exists and carries the five spacing knobs', () => {
    const g = DESIGN_GROUPS.find((x) => x.id === 'settingsWin');
    expect(g!.tokens.map((t) => t.id)).toEqual([
      'prefsPadTop', 'prefsTitleGap', 'prefsPadBottom', 'prefsPadSide', 'prefsSectionGap',
    ]);
  });
});

// v4.26: the Characters group — the character tool's formatting knobs.
// (The generic suites above already cover these tokens' uniqueness, live
// consumption, and fallback==default; here we pin the character-specific
// contracts that those can't see.)
describe('characters group', () => {
  const group = DESIGN_GROUPS.find((g) => g.id === 'characters');

  it('exists and carries the expected knobs', () => {
    expect(group).toBeTruthy();
    expect(group!.tokens.map((t) => t.id)).toEqual([
      'charCardRadius', 'charCardBorder', 'charHeaderGap', 'charFieldGap',
      'charDetailPad', 'charInputH', 'charImageH', 'charCardMinW',
      'charCardMinH', 'charDescLines', 'charWinW', 'charWinH',
    ]);
  });

  // charHeaderGap/charFieldGap moved here from Panels & Windows (v4.22/v4.23
  // origins). Their ids are users' persisted designVars keys and their cssVars
  // are what the stylesheet reads — BOTH must survive any future regrouping,
  // or saved overrides silently orphan.
  it('kept the moved tokens’ ids and cssVars identical', () => {
    expect(designToken('charFieldGap')?.cssVar).toBe('--dz-char-field-gap');
    expect(designToken('charHeaderGap')?.cssVar).toBe('--dz-char-header-gap');
  });

  it('description clamp is unitless — -webkit-line-clamp takes a bare number', () => {
    const t = designToken('charDescLines')!;
    expect(t.unit).toBe('');
    applyDesignVars({ charDescLines: 4 });
    expect(document.documentElement.style.getPropertyValue('--dz-char-desc-lines')).toBe('4');
    applyDesignVars({});
  });

  // The window-size defaults must equal ALL_TOOLS' defaultSize for
  // 'characters', or the sliders' reset target drifts from what the window
  // actually opens at. Pinned by grepping the ToolDock SOURCE — importing the
  // component would drag the whole UI graph into this unit test.
  it('window-size defaults match the characters defaultSize in ToolDock', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'ToolDock.tsx'), 'utf8');
    const m = src.match(/id:\s*'characters'[\s\S]*?defaultSize:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/);
    expect(m, "ALL_TOOLS entry for 'characters' not found in ToolDock.tsx").toBeTruthy();
    expect(designToken('charWinW')!.def).toBe(parseInt(m![1], 10));
    expect(designToken('charWinH')!.def).toBe(parseInt(m![2], 10));
  });

  // Store-bound window tokens: with no stored size they read the built-in
  // default; setting one dimension writes through setToolSize and carries the
  // other dimension over unchanged (the same entry the resize drag persists).
  it('window tokens read the store and write through setToolSize', () => {
    const winW = designToken('charWinW')!;
    const winH = designToken('charWinH')!;
    /* v7.70: start from NO stored size, don't assume it. That is the first
       half of what this test pins — a token with nothing stored reads its
       built-in default — and the shipped defaults now carry Derek's own
       Characters window size, so the assumption stopped holding. */
    const sizes = { ...useEditorStore.getState().toolSizes };
    delete sizes.characters;
    useEditorStore.setState({ toolSizes: sizes });
    expect(useEditorStore.getState().toolSizes.characters).toBeUndefined();
    expect(winW.store!.get(useEditorStore.getState())).toBe(winW.def);
    expect(winH.store!.get(useEditorStore.getState())).toBe(winH.def);

    winW.store!.set(500);
    expect(useEditorStore.getState().toolSizes.characters).toEqual({ w: 500, h: winH.def });
    winH.store!.set(480);
    expect(useEditorStore.getState().toolSizes.characters).toEqual({ w: 500, h: 480 });
    expect(winW.store!.get(useEditorStore.getState())).toBe(500);
    expect(winH.store!.get(useEditorStore.getState())).toBe(480);
  });
});
