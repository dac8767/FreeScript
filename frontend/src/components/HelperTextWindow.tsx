/**
 * HelperTextTool (v6.22 as a floating window; v6.52 a real TOOL) — Derek:
 * "Move the helper text section from the design window into it's own
 * window" … "allow dragging the help text window into a side panel."
 *
 * v6.52: the FloatingWindow shell and the helperTextWindowOpen flag are
 * gone — this is the tool BODY, rendered by ToolDock like every other
 * window, which is what buys docking, drag-out, fullscreen and size memory
 * for free. Opens from Help ▸ Developer ▸ Helper Text… (openTool). The
 * root keeps the .htw-panel class — the v6.24-era checks select rows
 * through it. Search + rows (HelperTextSection) are unchanged.
 */
import { useState } from 'react';
import { LuSearch } from 'react-icons/lu';
import { useEditorStore } from '../stores/editorStore';
import { HelperTextSection, filterHelperCatalog } from './HelperTextSection';

/** The "N changed" chip beside the window title (TOOL_CHROME.TitleExtra). */
export function HelperTextTitleExtra() {
  const editedCount = useEditorStore((s) => Object.keys(s.helperTextOverrides).length);
  if (editedCount === 0) return null;
  return <span className="dz-count">{editedCount} changed</span>;
}

export default function HelperTextTool() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const entries = filterHelperCatalog(q);

  return (
    <div className="htw-panel htw-tool">
      <div className="dz-search">
        <LuSearch className="dz-search-icon" />
        <input
          className="dz-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="dz-body">
        <HelperTextSection entries={entries} />
      </div>
    </div>
  );
}
