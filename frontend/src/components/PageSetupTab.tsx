/**
 * Settings ▸ Page Setup (v6.99) — Derek, via the feedback form: the old
 * Templates checkbox tab and the Page Setup tab are ONE tab now.
 *
 * The tab is the template LIST — what each template is and how to work on
 * one. (Until v7.81 a second half held SHOWN/HIDDEN columns configuring which
 * templates the New Script picker offered; Derek retired the filter — the
 * picker always shows every option now.)
 *
 * v7.50: the list is the Format ▸ Script Format / Template window's list —
 * literally, the same TemplateCard — with View added, since this is the one
 * place a template's page setup can be opened. The six built-ins are immutable
 * constants rather than rows in `templates[]`, so they offer View and Duplicate
 * and not Edit or Delete: updateTemplate() on one is a silent no-op. Custom
 * templates get all four. Creating starts from blank ("+ Create Template") or
 * from any row's Duplicate; the old "New Template…" dropdown asked for a base
 * and copied it, which is what Duplicate already does, so it is gone rather
 * than kept as a second way to do one thing.
 */
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { SYSTEM_TEMPLATE_LIST, useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import type { FormattingTemplate } from '../stores/formattingTypes';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';
import { useEditorStore } from '../stores/editorStore';
import TemplateEditorDialog from './TemplateEditorDialog';
import PageSetupDialog from './PageSetupDialog';
import TemplateCard from './TemplateCard';
import { useApplyTemplate } from '../hooks/useApplyTemplate';
import { showToast } from './Toast';

/* v7.10, Derek: "'page setup' used to have a full page of fields for the
   various measurement options. This is what you should seen when clicking view
   on an item in the current Page Setup tab. make equivalents for the other
   templates." — and, asked whether built-ins should be editable too: "Built
   ins".

   So View opens THE page of fields (PageSetupDialog, given a value + onSave)
   scoped to this template, not a seven-row read-only box. There is one such
   page in the app; this hands it a template's layout instead of the document's.

   The built-ins are why the layout is stored in the STORE and not on the
   template: the six system templates are immutable constants, so writing to
   one through updateTemplate() would be a silent no-op. */
/* v7.77, Derek: "the grayed out sections on the ruler (which shows the margins)
   should adjust when the page settings and margin sizes adjust."

   The rulers were fine. Measured across every page setting — left/right
   margins, top/bottom margins and page size — the shaded bands track the
   document's layout exactly, at every zoom. What did not move was the PAGE:
   saving here wrote the template's stored layout and stopped, so editing the
   margins of the template your script is using changed nothing on screen and
   still said "Page setup saved". Nothing to see is indistinguishable from a
   ruler that does not follow, and it is the silent no-op the v7.10 comment on
   useApplyTemplate warns about — it just moved one door along, from choosing a
   template to editing the one already chosen.

   So: if this IS the script's template, its measurements go onto the script,
   through the same one line applyTemplate uses. If it is any other template,
   the script must NOT move — a page setup you edited for a format you are not
   writing in has no business reflowing the draft — and the toast says which of
   the two happened rather than reporting the same success for both. */
function TemplatePageSetup({ t, isActive, onClose }: { t: FormattingTemplate; isActive: boolean; onClose: () => void }) {
  const getLayout = useFormattingTemplateStore((s) => s.getTemplatePageLayout);
  const getBase = useFormattingTemplateStore((s) => s.getTemplateBasePageLayout);
  const setLayout = useFormattingTemplateStore((s) => s.setTemplatePageLayout);
  const setPageLayout = useEditorStore((s) => s.setPageLayout);
  // Subscribed so Reset Default in another surface re-renders this one.
  useFormattingTemplateStore((s) => s.templatePageLayouts[t.id]);
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="fmt-dialog page-setup-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">{t.name} — Page Setup</div>
        <div className="fmt-dialog-body">
          <PageSetupDialog
            embedded
            value={getLayout(t.id)}
            resetTo={getBase(t.id)}
            onSave={(next) => {
              setLayout(t.id, next);
              if (isActive) {
                setPageLayout(next);
                showToast(`Page setup saved for ${t.name}, and applied to this script.`, 'success');
              } else {
                showToast(`Page setup saved for ${t.name}. New scripts will use it.`, 'success');
              }
            }}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

export default function PageSetupTab({ editor }: { editor?: Editor | null }) {
  const templates = useFormattingTemplateStore((s) => s.templates);
  const createTemplate = useFormattingTemplateStore((s) => s.createTemplate);
  const updateTemplate = useFormattingTemplateStore((s) => s.updateTemplate);
  // null means Industry Standard — the card's `current` badge needs the real id.
  const activeId = useFormattingTemplateStore((s) => s.activeTemplateId) || INDUSTRY_STANDARD_ID;
  /* v7.81, Derek: "remove the show/hide function for NEW SCRIPT PICKER. a new
     script will always show all options." The Shown/Hidden columns, the
     enabledScriptFormats plumbing and the ≥1 rule are gone with the filter —
     the picker offers every format now, so there is nothing here to configure. */
  const userTemplates = templates.filter((t) => t.category !== 'system');
  const all: FormattingTemplate[] = [...SYSTEM_TEMPLATE_LIST, ...userTemplates];

  const [editing, setEditing] = useState<FormattingTemplate | null>(null);
  const [viewing, setViewing] = useState<FormattingTemplate | null>(null);
  /* v7.51, Derek: "the window lacks the ability to select a template and apply
     it, like the other window has." So a row here is a choice as well as a
     thing to manage, and it starts on the one the script is already using —
     the same place the Format window starts. */
  const [selectedId, setSelectedId] = useState<string>(activeId);
  const { requestApply, conflictDialog } = useApplyTemplate(
    editor ?? null,
    (t) => showToast(`“${t.name}” applied to the script.`, 'success'),
  );


  /* The union of built-ins and custom ones — the built-ins are constants
     rather than rows in `templates`, so neither list alone can resolve an id. */
  const selectedTemplate = all.find((t) => t.id === selectedId) ?? null;

  const createBlank = async () => {
    setEditing(await createTemplate({ name: 'New Template' }));
  };

  /* v7.12, Derek: "add a list of all of the page setup templates to the top of
     the page setup tab. this list is where the view, edit, and delete (for
     custom templates only) buttons are. bellow that is the shown and hidden
     columns."

     v7.50, Derek, pointing at Format ▸ Script Format / Template: "this is the
     window that should be duplicated in the setting > page setup tab. use the
     window shown in the screenshot, and add the view button. keep the
     shown/hidden section below this."

     So the list up here IS that window's list — the same TemplateCard, in the
     same two sections, with View added because this is the one place there is
     something to view. Not a copy of it: the tab had grown its own row markup,
     and the two had already drifted apart (that window showed the mode badge
     and marked which template the script is CURRENTLY using; this one showed
     neither).

     The tab keeps its own second half, because that answers a different
     question: the list says what each template is and how to work on one, the
     columns say WHICH ones the New Script picker offers. */
  const card = (t: FormattingTemplate) => (
    <TemplateCard
      key={t.id}
      template={t}
      isCurrent={t.id === activeId}
      selected={t.id === selectedId}
      onSelect={() => setSelectedId(t.id)}
      onView={() => setViewing(t)}
      onEdit={setEditing}
    />
  );

  return (
    <>
      <div className="prefs-general">
        <section>
          <h3>Page Templates</h3>
          {/* v7.81, Derek: hint removed (helper-text cull). */}
          <div className="pst-list template-select-list">
            <div className="template-select-category">Script Formats</div>
            {SYSTEM_TEMPLATE_LIST.map(card)}
            <div className="template-select-category">User Defined</div>
            {userTemplates.length === 0
              ? <div className="template-select-empty">No custom templates yet.</div>
              : userTemplates.map(card)}
          </div>
          {/* v7.50: the old "New Template…" row asked for a base in a dropdown
              and then copied it. Every row now carries Duplicate, which is the
              same operation with a better handle on it, so the dropdown is
              gone rather than kept as a second way to do one thing. What is
              left is the one thing Duplicate cannot do: start from blank. */}
          <div className="pst-newrow">
            <button
              className="dialog-btn"
              title="Start a new template from scratch, or use Duplicate on a row above to base one on it"
              onClick={() => { void createBlank(); }}
            >
              + Create Template
            </button>
            <div className="pst-newrow-spacer" />
            {/* v7.51: applying goes through the SAME flow the Format window
                uses — conflicts asked about, page layout carried over, starter
                content only into an empty document. Settings stays open
                afterwards and says so with a toast; closing the whole window
                out from under someone mid-configuration would be its own
                surprise. */}
            <button
              className="dialog-btn dialog-btn-primary"
              disabled={!selectedTemplate}
              title={selectedTemplate
                ? `Format the open script with “${selectedTemplate.name}”`
                : 'Choose a template above first'}
              onClick={() => { if (selectedTemplate) void requestApply(selectedTemplate); }}
            >
              Apply to Script
            </button>
          </div>
        </section>
      </div>

      {conflictDialog}

      {viewing && (
        <TemplatePageSetup
          t={viewing}
          isActive={viewing.id === activeId}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <TemplateEditorDialog
          template={editing}
          onSave={async (updated) => {
            await updateTemplate(updated.id, updated);
            setEditing(null);
            showToast('Template saved', 'success');
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}
