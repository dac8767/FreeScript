// v4.24: Help → About, extracted from MenuBar (component split step 4). Pure
// presentation over APP_VERSION + the compat table; What's New hands off to the
// parent, which owns the changelog dialog.
import React from 'react';
import { openInBrowser, DONATE_URL } from '../services/external';
import { APP_VERSION } from '../data/changelog';
import { getCompatEntries } from '../services/compat';
import { Modal } from './Modal';

/** v4.76, Derek: every About link routes through openInBrowser — the raw
 *  target="_blank" anchors stalled (or died) in the desktop WebView, while
 *  the donate button's openInBrowser path opens the DEFAULT BROWSER
 *  instantly. The href stays for hover/status affordance; the click is ours. */
const Ext: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a
    href={href}
    onClick={(e) => { e.preventDefault(); openInBrowser(href); }}
  >
    {children}
  </a>
);

export function AboutDialog({ onClose, onShowChangelog }: { onClose: () => void; onShowChangelog: () => void }) {
  return (
    <Modal onClose={onClose} boxClassName="about-dialog">
        <div className="dialog-header">About ScriptCraft</div>
        <div className="dialog-body about-body">
          <img className="about-logo" src="/splash-logo.png" alt="ScriptCraft" />
          <div className="about-title">ScriptCraft</div>
          <div className="about-version">
            Version {APP_VERSION}
            {/* v3.24 reorg #7: the changelog's home is here now */}
            <button className="about-whatsnew" onClick={onShowChangelog}>
              What's New
            </button>
          </div>
          <div className="about-tagline">Free, open-source screenwriting software</div>
          <div className="about-credit">
            Built from the{' '}
            <Ext href="https://github.com/Proteus-Technologies-Private-Limited/OpenDraft">OpenDraft</Ext>{' '}
            source code by Proteus Technologies.
          </div>
          {/* v4.76, Derek's standing rule: this list tracks package.json (and
              the backend's requirements). Removing a tool that retires a
              library — or adding/swapping one — updates this list in the SAME
              change. Audited v4.76: everything below is still shipped;
              html2canvas-pro (screenshots, v4.70) and pdf.js (PDF import)
              joined. v6.40: Yjs & Hocuspocus left with the Collaboration
              removal. */}
          <div className="about-credit about-oss">
            Made possible by open source:{' '}
            <Ext href="https://react.dev">React</Ext>,{' '}
            <Ext href="https://tiptap.dev">TipTap</Ext> /{' '}
            <Ext href="https://prosemirror.net">ProseMirror</Ext>,{' '}
            <Ext href="https://vite.dev">Vite</Ext>,{' '}
            <Ext href="https://www.typescriptlang.org">TypeScript</Ext>,{' '}
            <Ext href="https://zustand.docs.pmnd.rs">Zustand</Ext>,{' '}
            <Ext href="https://reactrouter.com">React Router</Ext>,{' '}
            <Ext href="https://recharts.org">Recharts</Ext>,{' '}
            <Ext href="https://dndkit.com">dnd kit</Ext>,{' '}
            <Ext href="https://react-icons.github.io/react-icons/">React Icons</Ext>,{' '}
            <Ext href="https://github.com/parallax/jsPDF">jsPDF</Ext>,{' '}
            <Ext href="https://mozilla.github.io/pdf.js/">pdf.js</Ext>,{' '}
            <Ext href="https://github.com/dolanmiu/docx">docx</Ext>,{' '}
            <Ext href="https://stuk.github.io/jszip/">JSZip</Ext>,{' '}
            <Ext href="https://github.com/cure53/DOMPurify">DOMPurify</Ext>,{' '}
            <Ext href="https://github.com/yorickshan/html2canvas-pro">html2canvas-pro</Ext>,{' '}
            <Ext href="https://writewithharper.com">Harper</Ext>,{' '}
            <Ext href="https://github.com/cfinke/Typo.js">Typo.js</Ext>,{' '}
            <Ext href="https://github.com/retextjs/retext">retext</Ext> /{' '}
            <Ext href="https://unifiedjs.com">unified</Ext>,{' '}
            <Ext href="https://tauri.app">Tauri</Ext>,{' '}
            <Ext href="https://github.com/hwchen/keyring-rs">keyring-rs</Ext>,{' '}
            <Ext href="https://fastapi.tiangolo.com">FastAPI</Ext>,{' '}
            <Ext href="https://www.dulwich.io">Dulwich</Ext>,{' '}
            <Ext href="https://alembic.sqlalchemy.org">Alembic</Ext>, and the{' '}
            {/* v6.03: the Thesaurus tool's data — Princeton WordNet 3.1
                directly (senses, synonyms, and definitions; license ships
                in public/thesaurus/). It replaced the MyThes file, which
                carried no definitions. */}
            Princeton{' '}
            <Ext href="https://wordnet.princeton.edu">WordNet</Ext>{' '}
            lexical database (thesaurus &amp; definitions).
          </div>


          <div className="about-whats-new">
            <div className="about-section-title">Compatibility</div>
            {/* v7.04 (style audit item 13): this table styled itself inline,
                including a hardcoded light error block that was unreadable in
                every dark theme. It reads the stylesheet now, and the status
                colours are the shared state tokens. */}
            <table className="about-compat">
              <thead>
                <tr>
                  <th>Subsystem</th>
                  <th>Status</th>
                  <th>Implementation</th>
                </tr>
              </thead>
              <tbody>
                {getCompatEntries().map((entry) => (
                  <React.Fragment key={entry.label}>
                    <tr>
                      <td className="about-compat-name">{entry.label}</td>
                      <td>
                        <span className={`about-compat-dot about-compat-dot--${entry.mode === 'primary' ? 'primary' : 'fallback'}`} />
                        <span className={`about-compat-state about-compat-state--${entry.mode === 'primary' ? 'primary' : 'fallback'}`}>
                          {entry.mode === 'primary' ? 'Latest' : 'Fallback'}
                        </span>
                      </td>
                      <td className="about-compat-using">{entry.using}</td>
                    </tr>
                    {entry.errorReason && (
                      <tr>
                        <td colSpan={3} className="about-compat-errcell">
                          <pre className="about-compat-err">{entry.errorReason}</pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* v3.18, Derek: donate rides the footer row — left, opposite
            Close. Yellow BMC config (#FFDD00 pill, white cup). */}
        <div className="dialog-actions about-actions">
          <button
            className="fs-bmc-btn"
            title="Buy me a coffee"
            onClick={() => openInBrowser(DONATE_URL)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 4.5 h10 l-0.4 2 h-9.2 Z" fill="#000" />
              <path d="M3.9 7 h8.2 l-1 6.2 a1 1 0 0 1 -1 0.8 h-4.2 a1 1 0 0 1 -1 -0.8 Z" fill="#fff" stroke="#000" strokeWidth="0.8" />
              <path d="M4.6 3 c0 -0.8 6.8 -0.8 6.8 0 l0.2 1.5 h-7.2 Z" fill="#fff" stroke="#000" strokeWidth="0.8" />
            </svg>
            <span>Buy me a coffee</span>
          </button>
          <button className="dialog-btn dialog-btn-primary" onClick={onClose}>Close</button>
        </div>
    </Modal>
  );
}
