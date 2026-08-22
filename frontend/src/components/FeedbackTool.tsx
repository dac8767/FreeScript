/**
 * FeedbackTool (v4.23 as an Airtable iframe; v6.84 native; v6.86 SIMPLE) —
 * Derek: "I do not need to verify emails. This is being tested with
 * friends only."
 *
 * The form asks name + email ONCE (a local tester profile, honor system,
 * editable any time) and every submission carries them — no codes, no
 * sign-in service, no SMTP. Submissions go to Derek's own Supabase table
 * through services/feedbackBackend; images attach via the labeled
 * Attachment area — capture the window or an area, or Browse… image
 * files, AS MANY AS NEEDED (v6.87 the area itself, v6.89 multiple
 * attachments + the blur-veil sent confirmation). (The v6.84 verified
 * email-code sign-in lives in git history for the day the app goes
 * public.)
 *
 * Failure is never silent: a submit that can't reach the server lands in a
 * visible local queue with a Retry button.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FaCamera, FaCrop, FaFolderOpen, FaTimes } from 'react-icons/fa';
import {
  type FeedbackProfile,
  loadFeedbackProfile, saveFeedbackProfile,
  submitFeedback, enqueueFeedback, loadFeedbackQueue, drainFeedbackQueue,
} from '../services/feedbackBackend';
import { captureToCanvas } from '../utils/screenshot';
import { showToast } from './Toast';

const CATEGORIES = ['Bug Report', 'Suggestion', 'Feature Request', 'Other'] as const;

/* v6.97 (Derek, via the feedback form): the v6.96 formatting BUTTONS are
   gone — "some are just adding markdown code". What stays is the part that
   felt right: type "- " or "1. " and Enter CONTINUES the list (numbers
   count up); Enter on an empty item ends it. The box stays a plain
   textarea and the message stays plain text. Pure — exported for tests. */
export function continueListOnEnter(value: string, caret: number): { value: string; caret: number } | null {
  const ls = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(ls, caret);
  // v6.98: a bare "-" / "1." with no trailing space counts as an (empty)
  // item too — but "-word" stays ordinary text.
  const m = /^(\s*)(-|(\d+)\.)( ?)(.*)$/.exec(line);
  if (!m) return null;
  const [, indent, , num, space, rest] = m;
  if (!space && rest !== '') return null;
  if (rest.trim() === '') {
    // Enter on an empty item ends the list — the marker comes off
    return { value: value.slice(0, ls) + indent + value.slice(caret), caret: ls + indent.length };
  }
  const insert = `\n${indent}${num ? `${parseInt(num, 10) + 1}. ` : '- '}`;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length };
}

interface Shot { blob: Blob; url: string; dataUrl: string; name: string }

async function canvasToShot(canvas: HTMLCanvasElement): Promise<Shot> {
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode the image.');
  return { blob, url: URL.createObjectURL(blob), dataUrl: canvas.toDataURL('image/png'), name: 'Screenshot' };
}

/** Browse…: any image file from disk becomes the attachment, format kept. */
async function fileToShot(file: File): Promise<Shot> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be attached here.');
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
  return { blob: file, url: URL.createObjectURL(file), dataUrl, name: file.name };
}

/* ── v6.88 (feedback row 224d5f61): the draft OUTLIVES the component.
   Every hosting surface — docked panel, floating window, fullscreen
   takeover — mounts its OWN copy of this form, so moving the window
   remounts it and useState starts over. The draft lives here at module
   level and every mount rehydrates from it, so a move (or an accidental
   close) keeps the text, category and attachment. In-memory on purpose:
   an app restart starts clean. */
interface FeedbackDraft { category: (typeof CATEGORIES)[number]; message: string; shots: Shot[] }
const EMPTY_DRAFT: FeedbackDraft = { category: 'Bug Report', message: '', shots: [] };
let draft: FeedbackDraft = EMPTY_DRAFT;

/** Test-only: the module draft would otherwise leak between tests. */
export function resetFeedbackDraft() { draft = EMPTY_DRAFT; }

export default function FeedbackTool() {
  const [profile, setProfile] = useState<FeedbackProfile | null>(() => loadFeedbackProfile());
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile?.name ?? '');
  const [emailDraft, setEmailDraft] = useState(profile?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(draft.category);
  const [message, setMessage] = useState(draft.message);
  const [shots, setShots] = useState<Shot[]>(draft.shots);
  const [queued, setQueued] = useState(() => loadFeedbackQueue().length);
  const [sentNote, setSentNote] = useState<string | null>(null);

  // Mirror the live fields into the module draft. (The old unmount-revoke
  // effect is gone ON PURPOSE — the shots' object URLs must outlive the
  // mount so the chips still render after a move; the remove/send paths
  // revoke them instead.)
  useEffect(() => { draft = { category, message, shots }; }, [category, message, shots]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setNote(null);
    try { await fn(); } catch (e) {
      setNote(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally { setBusy(false); }
  };

  const saveProfile = () => {
    const p = saveFeedbackProfile({ name: nameDraft, email: emailDraft });
    setProfile(p);
    setEditingProfile(false);
    setNote(null);
  };

  // v6.89, Derek: MORE than one attachment — every capture/pick APPENDS.
  const capture = (mode: 'full' | 'area') => run(async () => {
    const canvas = await captureToCanvas(mode, 'fs-shot-veil-feedback');
    if (!canvas) return;                      // cancelled the area drag
    const next = await canvasToShot(canvas);
    setShots((list) => [...list, next]);
  });

  const fileInput = useRef<HTMLInputElement>(null);
  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';                      // so the same files can be re-picked
    if (!files.length) return;
    run(async () => {
      const next = await Promise.all(files.map(fileToShot));
      setShots((list) => [...list, ...next]);
    });
  };

  const removeShot = (i: number) => {
    const gone = shots[i];
    if (gone) URL.revokeObjectURL(gone.url);
    setShots((list) => list.filter((_, k) => k !== i));
  };

  const submit = () => run(async () => {
    const payload = { category, message: message.trim() };
    const sending = shots;
    const finish = () => {
      setMessage('');
      sending.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
      draft = { ...draft, message: '', shots: [] };    // even if unmounted mid-send
    };
    try {
      await submitFeedback(payload, sending.map((s) => s.blob));
      finish();
      setSentNote('Your feedback has been sent. Thank you!');
      window.setTimeout(() => setSentNote(null), 3000);
    } catch (e) {
      // Not silent, not lost: queue it where the writer can SEE it.
      const left = enqueueFeedback({
        payload,
        shotDataUrls: sending.length ? sending.map((s) => s.dataUrl) : undefined,
        queuedAt: new Date().toISOString(),
      });
      setQueued(left);
      finish();
      throw new Error(`Could not reach the feedback server — saved to the local queue instead (${left} waiting). ${e instanceof Error ? e.message : ''}`);
    }
  });

  const retryQueue = () => run(async () => {
    const { sent, left } = await drainFeedbackQueue();
    setQueued(left);
    if (sent > 0) showToast(`Sent ${sent} queued feedback item${sent === 1 ? '' : 's'}`, 'success');
    if (left > 0) throw new Error(`${left} still could not be sent — they stay in the queue.`);
  });

  /* ── first open (or Edit): the once-only profile card ── */
  if (!profile || editingProfile) {
    const canSave = nameDraft.trim().length > 0 && emailDraft.trim().length > 0;
    return (
      <div className="feedback-tool-wrap fb-signin">
        <h3 className="fb-title">Send Feedback</h3>
        <p className="fb-hint">
          Tell the form who you are — once. Your name and email ride along
          with every piece of feedback so Derek knows who sent it.
        </p>
        {note && <div className="fb-note">{note}</div>}
        <div className="fb-row">
          <input
            className="fb-input"
            placeholder="Your name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </div>
        <div className="fb-row">
          <input
            className="fb-input"
            type="email"
            placeholder="you@example.com"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSave) saveProfile(); }}
          />
          <button className="dialog-btn dialog-btn-primary fb-go" disabled={!canSave} onClick={saveProfile}>
            Start
          </button>
          {profile && (
            <button className="dialog-btn fb-back" onClick={() => setEditingProfile(false)}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── the form ── */
  return (
    <div className="feedback-tool-wrap fb-form">
      <div className="fb-who">
        Name:<strong>{profile.name}</strong>
        <button
          className="fb-signout"
          title="Change name or email"
          onClick={() => { setNameDraft(profile.name); setEmailDraft(profile.email); setEditingProfile(true); }}
        >Edit</button>
      </div>

      {note && <div className="fb-note">{note}</div>}
      {sentNote && (
        <div className="fb-sent-veil" role="status">
          <div className="fb-sent-msg">{sentNote}</div>
        </div>
      )}
      {queued > 0 && (
        <div className="fb-queued">
          {queued} feedback item{queued === 1 ? '' : 's'} waiting to send
          <button className="dialog-btn fb-retry" disabled={busy} onClick={retryQueue}>Retry now</button>
        </div>
      )}

      <label className="fb-label fb-type-row">
        Type:
        <select className="fb-select" value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label className="fb-label fb-label-grow">
        Description:
        <textarea
          className="fb-text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            // v6.97: typed "- " / "1. " lists continue themselves on Enter
            if (e.key !== 'Enter' || e.shiftKey) return;
            const ta = e.currentTarget;
            if (ta.selectionStart !== ta.selectionEnd) return;
            // v6.98 (Derek: "it was inconsistent"): read the DOM's live value,
            // not the render-closure state — any lag between the two made
            // Enter see stale text and silently skip the continuation.
            const r = continueListOnEnter(ta.value, ta.selectionStart);
            if (!r) return;
            e.preventDefault();
            setMessage(r.value);
            requestAnimationFrame(() => ta.setSelectionRange(r.caret, r.caret));
          }}
        />
      </label>

      <div className="fb-attach">
        <div className="fb-attach-head">
          {/* v7.24, Derek: no paperclip, and the label reads as the instruction
              it is — the three buttons beside it are the answer to it. */}
          <span className="fb-attach-title">Add a Screenshot:</span>
          <div className="fb-attach-btns">
            <button className="dialog-btn" disabled={busy} title="Take a screenshot of the whole window" onClick={() => capture('full')}>
              <FaCamera aria-hidden /> Full Screen
            </button>
            <button className="dialog-btn" disabled={busy} title="Take a screenshot of a selected area" onClick={() => capture('area')}>
              <FaCrop aria-hidden /> Area
            </button>
            <button className="dialog-btn" disabled={busy} title="Attach image files from disk" onClick={() => fileInput.current?.click()}>
              <FaFolderOpen aria-hidden /> Browse…
            </button>
          </div>
        </div>
        {shots.length > 0 && (
          <div className="fb-shotchips">
            {shots.map((s, i) => (
              <span className="fb-shotchip" key={s.url}>
                <img className="fb-shotthumb" src={s.url} alt="Attached image" />
                <span className="fb-shotname">{s.name}</span>
                <button className="fb-shot-x" title="Remove attachment" onClick={() => removeShot(i)}><FaTimes aria-hidden /></button>
              </span>
            ))}
          </div>
        )}
        <input ref={fileInput} className="fb-file" type="file" accept="image/*" multiple onChange={pickFile} />
      </div>

      <div className="fb-shotrow">
        <span className="fb-spacer" />
        <button
          className="dialog-btn dialog-btn-primary fb-send"
          disabled={busy || !message.trim()}
          title="Send feedback"
          onClick={submit}
        >{busy ? 'Sending…' : 'Submit'}</button>
      </div>
    </div>
  );
}
