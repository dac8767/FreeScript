/**
 * Customize → Context Menu (v0.88; v1.81 Outlook-style).
 *
 * Same shape as the other layout tabs since v1.81: a Shown column and a
 * Hidden column (organized by the menu's categories), drag between them —
 * drop position is menu position. Rows keep the click fallback (× / +).
 *
 * Only top-level items live here. What's INSIDE an item is owned by that
 * feature's own tab — the elements under Element come from the Elements tab —
 * so one change updates every menu instead of the two drifting apart.
 */
import { useEditorStore } from '../stores/editorStore';
import {
  CONTEXT_MENU_SECTIONS, CONTEXT_MENU_GROUPS, type ContextMenuGroup,
} from './ScriptContextMenu';
import { DndColumns } from './CustomizePanelsDialog';

export default function ContextMenuTab() {
  const contextMenuHidden = useEditorStore((s) => s.contextMenuHidden);
  const setContextMenuHidden = useEditorStore((s) => s.setContextMenuHidden);
  const contextMenuOrder = useEditorStore((s) => s.contextMenuOrder);
  const setContextMenuOrder = useEditorStore((s) => s.setContextMenuOrder);

  const known = CONTEXT_MENU_SECTIONS.map((x) => x.id);
  const sectionOf = (id: string) => CONTEXT_MENU_SECTIONS.find((x) => x.id === id);
  const labelOf = (id: string) => sectionOf(id)?.label ?? id;

  // The user's arrangement first, then anything they haven't touched — so an
  // item added in a newer version still appears, at its default place.
  const fullOrder = [
    ...contextMenuOrder.filter((id) => known.includes(id)),
    ...known.filter((id) => !contextMenuOrder.includes(id)),
  ];
  const shown = fullOrder.filter((id) => !contextMenuHidden.includes(id));
  const hidden = fullOrder.filter((id) => contextMenuHidden.includes(id));

  const hiddenIn = (g: ContextMenuGroup) =>
    hidden.filter((id) => sectionOf(id)?.group === g);

  const show = (id: string) =>
    setContextMenuHidden(contextMenuHidden.filter((x) => x !== id));
  const hide = (id: string) =>
    setContextMenuHidden([...contextMenuHidden.filter((x) => x !== id), id]);

  return (
    <section>
      <h3>Context Menu</h3>
      {/* v7.81, Derek's wording — replaced the paragraph about drag mechanics
          and the permanent items. */}
      <p className="fs-customize-hint">
        Choose what appears in the toolbar that appears when you right-click on
        the script:
      </p>

      <DndColumns
        columns={[
          {
            id: 'shown', title: 'Shown',
            headerExtra: (
              <button className="fs-dnd-headbtn" title="Show every item" onClick={() => setContextMenuHidden([])}>Show All</button>
            ),
            sections: [{
              rows: shown.map((id) => ({
                key: id,
                content: (
                  <span className="fs-customize-tool">
                    {labelOf(id)}
                    <button className="fs-dnd-rowbtn" title="Hide this item" onClick={() => hide(id)}>×</button>
                  </span>
                ),
              })),
            }],
          },
          {
            id: 'hidden', title: 'Hidden', isHidden: true,
            headerExtra: (
              <button className="fs-dnd-headbtn" title="Hide every item" onClick={() => setContextMenuHidden(known)}>Hide All</button>
            ),
            sections: CONTEXT_MENU_GROUPS.map((g) => ({
              label: g,
              rows: hiddenIn(g).map((id) => ({
                key: id,
                content: (
                  <span className="fs-customize-tool">
                    {labelOf(id)}
                    <button className="fs-dnd-rowbtn" title="Show this item" onClick={() => show(id)}>+</button>
                  </span>
                ),
              })),
            })),
          },
        ]}
        onDrop={(src, dst) => {
          const id = src.key;
          if (dst.col === 'hidden') {
            if (!contextMenuHidden.includes(id)) hide(id);
            return;
          }
          const next = shown.filter((x) => x !== id);
          next.splice(Math.min(dst.idx, next.length), 0, id);
          setContextMenuOrder([...next, ...hidden.filter((x) => x !== id)]);
          if (contextMenuHidden.includes(id)) show(id);
        }}
      />

      {/* v4.66: Show All / Hide All live in the column headers; Reset is in
          the tab's Reset section. */}
    </section>
  );
}
