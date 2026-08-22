/**
 * v5.53, Derek: the Thesaurus tool. Local data only — MyThes en_US
 * (WordNet-derived, the set LibreOffice ships) bundled under
 * public/thesaurus/; nothing leaves the machine (utils/thesaurus.ts owns
 * parsing and the license story).
 *
 * How it behaves:
 * - Put the caret in (or select) a script word and the tool looks it up —
 *   the "In script" line names the live target.
 * - Type any word and hit Enter to browse freely; the script target
 *   survives so a replacement can still land on it.
 * - Click a word to look IT up (Back walks the trail); the ⇄ on each chip
 *   replaces the script word, dressed in its case (WALK → AMBLE).
 * - Antonyms (WordNet marks them) sit on their own row per sense.
 */
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaArrowLeft, FaExchangeAlt } from 'react-icons/fa';
/* v7.01 (style audit Q319): the search glyph is LuSearch app-wide (17 uses);
   this tool was the one place still drawing the heavier Fa version. */
import { LuSearch } from 'react-icons/lu';
import { showToast } from './Toast';
import {
  loadThesaurus, wordAt, matchCase, POS_LABELS,
  type ThesaurusApi, type ThesaurusEntry, type ThesaurusSense,
} from '../utils/thesaurus';
import { useHt } from '../utils/helperText';

interface ScriptTarget { from: number; to: number; word: string }

type LookupState =
  | { status: 'idle' }
  | { status: 'none'; query: string }
  | { status: 'hit'; query: string; matched: string; entry: ThesaurusEntry };

/** The word the current editor selection points at: the selection text when
 *  short (≤3 words), else the word around the caret. Doc positions ride
 *  along so Replace knows where to land. */
function scriptWordAtSelection(editor: Editor): ScriptTarget | null {
  const sel = editor.state.selection;
  if (!sel.empty) {
    const text = editor.state.doc.textBetween(sel.from, sel.to, ' ').trim();
    if (!text || text.length > 40 || text.split(/\s+/).length > 3) return null;
    if (!/\p{L}/u.test(text)) return null;
    return { from: sel.from, to: sel.to, word: text };
  }
  const $h = sel.$head;
  if (!$h.parent.isTextblock) return null;
  const w = wordAt($h.parent.textContent, $h.parentOffset);
  if (!w) return null;
  const base = $h.start();
  return { from: base + w.start, to: base + w.end, word: w.word };
}

export default function ThesaurusTool({ editor }: { editor: Editor | null }) {
  const ht = useHt();
  const [api, setApi] = useState<ThesaurusApi | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  const [target, setTarget] = useState<ScriptTarget | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = () => {
    setLoadErr(null);
    loadThesaurus().then(setApi).catch((e) => {
      setLoadErr(e instanceof Error ? e.message : String(e));
    });
  };
  useEffect(load, []);

  const runLookup = (raw: string, opts?: { keepHistory?: boolean }) => {
    if (!api) return;
    const word = raw.trim();
    if (!word) return;
    if (!opts?.keepHistory) setHistory([]);
    setInput(word);
    const hit = api.lookup(word);
    setState(hit
      ? { status: 'hit', query: word, matched: hit.matched, entry: hit.entry }
      : { status: 'none', query: word });
  };

  // Follow the script: caret/selection lands on a word → look it up and
  // retarget. Debounced past typing speed; doc edits re-derive too so the
  // target's positions never go stale silently.
  useEffect(() => {
    if (!editor || !api) return;
    let t = 0;
    const sync = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const info = scriptWordAtSelection(editor);
        if (!info) return;   // no word under the caret — keep what's shown
        setTarget((prev) => (
          prev && prev.from === info.from && prev.to === info.to && prev.word === info.word
            ? prev : info));
        const cur = stateRef.current;
        const shown = cur.status === 'idle' ? null : cur.query.toLowerCase();
        if (shown !== info.word.toLowerCase()) runLookup(info.word);
      }, 250);
    };
    editor.on('selectionUpdate', sync);
    editor.on('update', sync);
    /* v6.19, Derek: "if I already have a word highlighted, and then I open
       the thesaurus tool, it should open with the thesaurus info for that
       word." The listeners above only fire on LATER selection changes — run
       one sync now so the selection the tool opened over is looked up too
       (this also covers the data file finishing its load after mount, since
       the effect re-runs when `api` lands). */
    sync();
    return () => {
      window.clearTimeout(t);
      editor.off('selectionUpdate', sync);
      editor.off('update', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, api]);

  const chainTo = (word: string) => {
    const cur = stateRef.current;
    if (cur.status !== 'idle') setHistory((h) => [...h, cur.query]);
    runLookup(word, { keepHistory: true });
  };

  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    runLookup(prev, { keepHistory: true });
  };

  const replaceWith = (syn: string) => {
    if (!editor || !target) return;
    const current = editor.state.doc.textBetween(target.from, target.to, ' ');
    if (current !== target.word) {
      // the script moved under us — never write into the wrong range
      showToast('The script changed — click the word again to retarget.');
      return;
    }
    const next = matchCase(target.word, syn);
    editor.chain().focus()
      .insertContentAt({ from: target.from, to: target.to }, next)
      .run();
    setTarget({ from: target.from, to: target.from + next.length, word: next });
  };

  const senseRow = (sense: ThesaurusSense, i: number) => {
    const syns = sense.words.filter((w) => !w.antonym);
    const ants = sense.words.filter((w) => w.antonym);
    const chip = (word: string, antonym: boolean) => (
      <span key={word} className={`thes-chip${antonym ? ' thes-ant' : ''}`}>
        <button
          className="thes-word"
          title={`Look up “${word}”`}
          onClick={() => chainTo(word)}
        >{word}</button>
        {target && (
          <button
            className="thes-use"
            title={`Replace “${target.word}” in the script`}
            onClick={() => replaceWith(word)}
          ><FaExchangeAlt /></button>
        )}
      </span>
    );
    return (
      <div key={i} className="thes-sense">
        <span className="thes-pos">{POS_LABELS[sense.pos] ?? sense.pos}</span>
        <div className="thes-body">
          {/* v6.03, Derek: the sense's DEFINITION rides above its synonyms —
              WordNet's gloss, so picking between senses no longer means
              guessing from the synonyms alone. */}
          {sense.gloss && <div className="thes-def">{sense.gloss}</div>}
          {(syns.length > 0 || ants.length > 0) && (
            <div className="thes-words">
              {syns.map((w) => chip(w.word, false))}
              {ants.length > 0 && (
                <span className="thes-ant-row">
                  <span className="thes-ant-label" title="Antonyms">ant.</span>
                  {ants.map((w) => chip(w.word, true))}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="thesaurus-tool">
      <div className="thes-search-row">
        <button
          className="thes-back"
          title="Back"
          disabled={history.length === 0}
          onClick={goBack}
        ><FaArrowLeft /></button>
        <input
          className="thes-input"
          value={input}
          placeholder="Look up a word…"
          disabled={!api}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runLookup(input); }}
        />
        <button
          className="thes-go"
          title="Look up"
          disabled={!api}
          onClick={() => runLookup(input)}
        ><LuSearch /></button>
      </div>
      {target && (
        <div className="thes-context">
          In script: <b>{target.word}</b>
        </div>
      )}
      <div className="thes-body">
        {!api && !loadErr && <div className="thes-status">Loading thesaurus…</div>}
        {loadErr && (
          <div className="thes-status">
            Couldn’t load the thesaurus data ({loadErr}).
            <button className="dialog-btn thes-retry" onClick={load}>Retry</button>
          </div>
        )}
        {api && state.status === 'idle' && (
          <div className="thes-status">
            {ht('Click a word in the script or type one above')}
          </div>
        )}
        {api && state.status === 'none' && (
          <div className="thes-status">No synonyms found for “{state.query}”.</div>
        )}
        {api && state.status === 'hit' && (
          <>
            {state.matched.toLowerCase() !== state.query.toLowerCase() && (
              <div className="thes-note">Showing “{state.matched}”</div>
            )}
            {state.entry.senses.map(senseRow)}
          </>
        )}
      </div>
    </div>
  );
}
