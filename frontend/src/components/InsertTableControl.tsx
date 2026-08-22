/**
 * InsertTableControl — the Scrapbook's Insert Table button and its row/column
 * grid picker.
 *
 * v7.47: lifted out of Toolbar's renderBuiltinControl, the second of the four
 * cases in that switch that carried their own state (zoom was the first, in
 * v7.46). Everything here — the open flag, the measured position, the
 * outside-click listener — was private to this control and only looked like
 * Toolbar's because it was declared there.
 *
 * THE POPUP IS PORTALLED AND POSITIONED BY MEASURED top/left. Both halves of
 * that are scars, and neither is optional:
 *   · an absolutely-positioned child cannot escape an ancestor's stacking
 *     context or overflow, so a popup rendered inside the toolbar renders
 *     but cannot be clicked;
 *   · anchoring by `bottom` collapses the box to a sliver in WebKit, which is
 *     what the app ships on.
 * So the trigger's rect is read on click and the popup goes to document.body
 * at those coordinates.
 *
 * The outside-click listener tests for `.toolbar-tablegrid-anchor`, which is
 * on BOTH the trigger's wrapper and the portalled popup — that is what stops a
 * click inside the picker closing the picker.
 */
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNotebookStore } from '../stores/notebookStore';
import { TableGridPicker } from './NotebookTool';
import { TOOLBAR_ICONS } from './uiIcons';

interface InsertTableControlProps {
  /** False while the toolbar is measuring its overflow — popups must not
   *  render into that pass or they flash. */
  showPopups: boolean;
}

const InsertTableControl: React.FC<InsertTableControlProps> = ({ showPopups }) => {
  const scrapbookOpen = useNotebookStore((s) => s.notebookOpen);
  const scrapbookPage = useNotebookStore((s) => !!s.selectedPageId);

  const [tableGridOpen, setTableGridOpen] = useState(false);
  const [tableGridPos, setTableGridPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!tableGridOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.toolbar-tablegrid-anchor')) setTableGridOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tableGridOpen]);

  // Same visibility as its old menu: it belongs to the Scrapbook.
  if (!scrapbookOpen) return null;

  return (
    <div className="toolbar-group toolbar-tablegrid-anchor">
      <button
        className={`toolbar-btn${tableGridOpen ? ' active' : ''}`}
        disabled={!scrapbookPage}
        title={scrapbookPage ? 'Insert Table' : 'Select a Scrapbook page first'}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setTableGridPos({ top: r.bottom + 4, left: r.left });
          setTableGridOpen(!tableGridOpen);
        }}
      >{TOOLBAR_ICONS.insertTable}</button>
      {showPopups && tableGridOpen && tableGridPos && createPortal(
        <div
          className="toolbar-tablegrid-popup toolbar-tablegrid-anchor"
          style={{ top: tableGridPos.top, left: tableGridPos.left }}
        >
          <TableGridPicker
            onPick={(rows, cols) => {
              window.dispatchEvent(new CustomEvent('nb-add-table-canvas', { detail: { rows, cols } }));
              setTableGridOpen(false);
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
};

export default InsertTableControl;
