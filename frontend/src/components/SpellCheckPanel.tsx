/**
 * SpellCheckPanel — Spelling & Grammar as a dockable window.
 *
 * v1.63: the docked panel now carries the FULL feature set the Tools-menu
 * submenu had, instead of just the spell checker: a Spelling tab and a
 * Suggestions (grammar/style) tab, the two auto-check toggles, and the
 * rules Settings. One Spelling & Grammar, one home (the Project menu), and
 * it docks into either sidebar or the toolbar like any tool.
 *
 * One-instance rule (the v0.63 lesson): whichever tab is showing sets the
 * corresponding modal-open flag so the checker runs, and sets its
 * *PanelMounted flag so ScreenplayEditor suppresses the global floating
 * instance — the panel owns the checker while it's mounted.
 */
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import SpellCheckModal from './SpellCheckModal';
import WritingSuggestionsModal from './WritingSuggestionsModal';

interface SpellCheckPanelProps {
  editor: Editor | null;
}

export default function SpellCheckPanel({ editor }: SpellCheckPanelProps) {
  const {
    spellCheckEnabled, toggleSpellCheck,
    grammarCheckEnabled, toggleGrammarCheck,
    setSpellModalOpen, setSpellPanelMounted,
    setGrammarModalOpen, setGrammarPanelMounted,
    setGrammarRulesPanelOpen,
  } = useEditorStore();

  const [tab, setTab] = useState<'spelling' | 'suggestions'>('spelling');

  // The active tab owns its checker: open flag makes it run, mounted flag
  // suppresses the floating twin. The inactive tab's flags are off.
  useEffect(() => {
    const spelling = tab === 'spelling';
    setSpellPanelMounted(spelling);
    setSpellModalOpen(spelling);
    setGrammarPanelMounted(!spelling);
    setGrammarModalOpen(!spelling);
    return () => {
      setSpellPanelMounted(false);
      setSpellModalOpen(false);
      setGrammarPanelMounted(false);
      setGrammarModalOpen(false);
    };
  }, [tab, setSpellModalOpen, setSpellPanelMounted, setGrammarModalOpen, setGrammarPanelMounted]);

  if (!editor) {
    return <div className="fs-panel-empty">Open a script to run spelling &amp; grammar.</div>;
  }

  return (
    <div className="fs-spellgram">
      <div className="fs-spellgram-top">
        <div className="fs-spellgram-tabs">
          <button className={tab === 'spelling' ? 'active' : ''} onClick={() => setTab('spelling')}>
            Spelling
          </button>
          <button className={tab === 'suggestions' ? 'active' : ''} onClick={() => setTab('suggestions')}>
            Suggestions
          </button>
        </div>
        <button
          className="fs-spellgram-settings"
          onClick={() => setGrammarRulesPanelOpen(true)}
        >
          Settings…
        </button>
      </div>

      <div className="fs-spellgram-autos">
        <label>
          <input type="checkbox" checked={spellCheckEnabled} onChange={toggleSpellCheck} />
          <span>Auto Spell Check</span>
        </label>
        <label>
          <input type="checkbox" checked={grammarCheckEnabled} onChange={toggleGrammarCheck} />
          <span>Auto Writing Suggestions</span>
        </label>
      </div>

      {tab === 'spelling'
        ? <SpellCheckModal editor={editor} embedded onClose={() => {}} />
        : <WritingSuggestionsModal editor={editor} embedded onClose={() => {}} />}
    </div>
  );
}
