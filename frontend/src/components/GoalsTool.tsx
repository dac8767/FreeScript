/**
 * GoalsTool — ported from ScriptCraft v5.5's Goals (which absorbed the old
 * Write Sprint). Set a target and keep it in view while you write: a word
 * count, a page count, or a timed session. Progress renders here and as a
 * chip in the status bar, and lights up green when you hit it.
 *
 * v1.82: Goals also absorbed VOMIT DRAFT. Any goal can be started with
 * "Vomit Draft Mode" on — until the goal is reached (or the time is up),
 * previous text is locked and you can only write forward (the VomitLock
 * transaction filter, unchanged underneath). Time goals can run for an
 * amount of minutes OR until a clock time. Hemingway mode is gone.
 *
 * The active goal persists across reloads (time goals store their wall-clock
 * end, so the countdown survives a refresh). The LOCK does not persist —
 * an app restart releases it, same as the old Vomit Draft.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore, type WritingGoal } from '../stores/editorStore';
import { useVomitStore } from '../stores/vomitStore';
import { vomitFloorFor } from '../editor/extensions/VomitLock';
import { computeOverviewStats } from '../utils/scriptStatistics';
import { useSettingsStore } from '../stores/settingsStore';
import type { ToolChromeTab } from './ToolControls';
import TimeField from './TimeField';
import { showToast } from './Toast';

function fmtMs(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Progress readout for the active goal — shared with the StatusBar chip. */
export function useGoalProgress(words: number, pages: number) {
  const { goal, setGoal } = useEditorStore();
  const [, force] = useState(0);

  useEffect(() => {
    if (!goal || goal.kind !== 'time' || goal.done) return;
    const t = setInterval(() => {
      if (Date.now() >= (goal.endsAt || 0)) {
        setGoal((g) => (g && g.kind === 'time' ? { ...g, done: true } : g));
      } else {
        force((x) => x + 1);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [goal, setGoal]);

  let result: { done: boolean; pct: number; label: string } | null = null;
  if (goal && goal.kind === 'time') {
    const remaining = Math.max(0, (goal.endsAt || 0) - Date.now());
    const done = !!goal.done || remaining <= 0;
    result = {
      done,
      pct: done ? 100 : 100 - (remaining / ((goal.total || 1) * 1000)) * 100,
      label: done ? `${goal.target} min done` : `${fmtMs(remaining)} left`,
    };
  } else if (goal) {
    const current = goal.kind === 'pages' ? pages : words;
    /* v6.15, Derek: 'relative' count goals ("Finish N Pages" / "Write N
       Words") measure GROWTH from the count captured at start — finish 5
       pages while on 7 and the goal completes at 12. */
    const rel = goal.mode === 'relative';
    const progressed = rel ? Math.max(0, current - (goal.baseline ?? 0)) : current;
    const done = progressed >= goal.target;
    result = {
      done,
      pct: Math.min(100, (progressed / goal.target) * 100),
      label: rel
        ? `${progressed.toLocaleString()} / ${goal.target.toLocaleString()} ${goal.kind} written`
        : `${current.toLocaleString()} / ${goal.target.toLocaleString()} ${goal.kind}`,
    };
  }

  // v1.82: a completed goal releases Vomit Draft Mode's lock. Lives in this
  // shared hook so it fires even with the Goals window closed (the StatusBar
  // chip keeps it mounted). Timed locks also expire on their own clock; this
  // covers word/page goals, whose lock has no clock (endsAt null).
  const releasedRef = useRef(false);
  const done = !!result?.done;
  useEffect(() => {
    if (!done) { releasedRef.current = false; return; }
    if (releasedRef.current) return;
    releasedRef.current = true;
    const s = useVomitStore.getState();
    if (s.session) {
      s.end();
      showToast('Goal reached — Vomit Draft Mode off, full editing is back.', 'success');
    }
  }, [done]);

  return result;
}


/** v6.02, Derek: "make the tabs in the Goal window aligned left, just like
 *  all other tabs in headers of windows." The Words/Pages/Time buttons were
 *  a bespoke `fs-goal-tabs` cluster living in the CONTROLS slot — the right
 *  side of the header. Registering them through TOOL_CHROME's useTabs slot
 *  instead puts them where every window's tabs go (left), in the shared
 *  ChromeTabs rendering, with nothing Goals-specific left to drift. */
export function useGoalTabs(): ToolChromeTab[] {
  const kind = useEditorStore((s) => s.goalKind);
  const setKind = useEditorStore((s) => s.setGoalKind);
  // v1.92: while Vomit Draft locks the script, the window is JUST the lock
  // readout — the tabs hide with everything else.
  const locked = useVomitStore((s) => !!s.session);
  if (locked) return [];
  return (['words', 'pages', 'time'] as const).map((k) => ({
    label: k[0].toUpperCase() + k.slice(1),
    active: kind === k,
    onSelect: () => setKind(k),
  }));
}

/** v6.15, Derek: ONE chip renders the running goal — the status bar
 *  (footer) and the ribbon toolbar both mount THIS, gated by goalShowIn, so
 *  the two readouts cannot drift. The host passes the word count (each host
 *  already owns a doc source); pages come from the store. (The Goals ?
 *  helper button is GONE — "the window is self explanatory".) */
export function GoalChip({ variant, words }: { variant: 'status' | 'toolbar'; words: number }) {
  const goal = useEditorStore((s) => s.goal);
  const pageCount = useEditorStore((s) => s.pageCount);
  const progress = useGoalProgress(words, pageCount);
  if (!goal || !progress) return null;
  return (
    <button
      className={`status-goal goal-chip-${variant}${variant === 'status' ? ' status-item' : ''}${progress.done ? ' done' : ''}`}
      title={progress.done ? 'Goal complete. Click to clear' : 'Click to open Goals'}
      onClick={() => {
        if (progress.done) {
          useEditorStore.getState().incrementGoalsCompleted();
          useEditorStore.getState().setGoal(null);
        } else useEditorStore.getState().openTool('goals');
      }}
    >
      <span className="status-goal-track"><span style={{ width: `${progress.pct}%` }} /></span>
      {progress.label}
    </button>
  );
}

/** Word count for the goal chip, computed from the live editor (the ribbon
 *  host has the editor instance, not a doc snapshot). */
export function useGoalWords(editor: Editor | null): number {
  const goal = useEditorStore((s) => s.goal);
  const pageCount = useEditorStore((s) => s.pageCount);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const f = () => setTick((t) => t + 1);
    editor.on('update', f);
    return () => { editor.off('update', f); };
  }, [editor]);
  return useMemo(() => {
    if (!editor || !goal || goal.kind !== 'words') return 0;
    try { return computeOverviewStats(editor.getJSON(), pageCount).totalWords; }
    catch { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, goal, tick, pageCount]);
}

interface GoalsToolProps {
  editor: Editor | null;
}

export default function GoalsTool({ editor }: GoalsToolProps) {
  const { goal, setGoal, pageCount } = useEditorStore();
  const vomitSession = useVomitStore((s) => s.session);
  const [docTick, setDocTick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setDocTick((t) => t + 1);
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); };
  }, [editor]);

  const words = useMemo(() => {
    if (!editor) return 0;
    try { return computeOverviewStats(editor.getJSON(), pageCount).totalWords; }
    catch { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick, pageCount]);

  const progress = useGoalProgress(words, pageCount);

  const DEFAULT_TARGETS: Record<WritingGoal['kind'], number> = { words: 500, pages: 2, time: 60 };
  // v1.85: the kind is store state — the header tabs set it.
  const kind = useEditorStore((s) => s.goalKind);
  const [targets, setTargets] = useState<Record<WritingGoal['kind'], number>>(
    () => ({ ...DEFAULT_TARGETS, ...(goal ? { [goal.kind]: goal.target } : {}) }),
  );
  const target = targets[kind];
  const setTarget = (v: number) => setTargets((t) => ({ ...t, [kind]: v }));

  // v1.82: Vomit Draft Mode — checked when the goal starts, it locks previous
  // text until the goal is done (any goal kind). Timed goals get a clocked
  // lock; word/page goals a clockless one released by the progress watcher.
  const [vomitMode, setVomitMode] = useState(false);
  const [untilTime, setUntilTime] = useState('');   // canonical "HH:MM"
  // v1.93: the Time tab is an either/or — write FOR an amount, or UNTIL a
  // clock time — with ONE Start button (two competing Starts read as noise).
  const [timeMode, setTimeMode] = useState<'for' | 'until'>('for');
  /* v6.15, Derek: Words/Pages are an either/or like Time — Reach an absolute
     total, or a RELATIVE "Finish N Pages" / "Write N Words" from wherever
     the script stands when the goal starts. */
  const [countMode, setCountMode] = useState<'reach' | 'relative'>('reach');
  const [relTargets, setRelTargets] = useState<Record<'words' | 'pages', number>>({ words: 500, pages: 5 });
  const goalShowIn = useEditorStore((st) => st.goalShowIn);
  const setGoalShowIn = useEditorStore((st) => st.setGoalShowIn);

  const startLock = (endsAt: number | null) => {
    if (!vomitMode || !editor || editor.isDestroyed) return;
    useVomitStore.getState().start(endsAt, vomitFloorFor(editor.state.doc));
    editor.commands.focus('end');
  };

  const startTime = (m: number) => {
    const endsAt = Date.now() + m * 60000;
    setGoal({ kind: 'time', target: m, total: m * 60, endsAt });
    startLock(endsAt);
  };
  const startUntil = () => {
    const match = /^(\d{2}):(\d{2})$/.exec(untilTime);
    if (!match) return;
    const end = new Date();
    end.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (end.getTime() <= Date.now()) end.setDate(end.getDate() + 1); // next occurrence
    const m = Math.max(1, Math.round((end.getTime() - Date.now()) / 60000));
    setGoal({ kind: 'time', target: m, total: m * 60, endsAt: end.getTime() });
    startLock(end.getTime());
  };
  const startCount = () => {
    if (kind === 'time') return;
    if (countMode === 'relative') {
      const t = Math.max(1, Number(relTargets[kind]) || 1);
      setGoal({ kind, target: t, mode: 'relative', baseline: current });
    } else {
      setGoal({ kind, target: Math.max(1, Number(target) || 1) });
    }
    startLock(null);   // no clock — the progress watcher releases it
  };

  const stopGoal = () => {
    if (progress?.done) useEditorStore.getState().incrementGoalsCompleted();
    setGoal(null);
    if (useVomitStore.getState().session) {
      useVomitStore.getState().end();
      showToast('Vomit Draft Mode off — full editing is back.', 'info');
    }
  };

  const current = kind === 'pages' ? pageCount : words;
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  void timeFormat; // TimeField reads the setting itself; subscribing re-renders us on change

  // v1.92: while the lock runs, the window is ONLY the lock readout (the
  // upper-right pill is gone — this panel is where the lock lives now).
  const blockedTick = useVomitStore((s) => s.blockedTick);
  const [pulse, setPulse] = useState(false);
  const firstTick = useRef(true);
  useEffect(() => {
    if (firstTick.current) { firstTick.current = false; return; }
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [blockedTick]);

  const progressBlock = goal && progress && (
    <div className={`fs-goal-progress${progress.done ? ' done' : ''}`}>
      <div className="fs-goal-progress-bar">
        <div style={{ width: `${progress.pct}%` }} />
      </div>
      <div className="fs-goal-progress-label">
        {progress.done ? '🎉 ' : ''}{progress.label}
      </div>
      {vomitSession && (
        <div className={`fs-goal-vomit-note${pulse ? ' blocked' : ''}`}>
          🔒 Vomit Draft Mode — previous text is locked until the goal is done.
        </div>
      )}
    </div>
  );

  if (vomitSession) {
    return (
      <div className="fs-goals fs-goals-locked">
        {progressBlock || (
          // Shouldn't happen (locks only start with a goal), but never
          // trap the user with an empty locked window.
          <div className="fs-goal-progress">
            <div className={`fs-goal-vomit-note${pulse ? ' blocked' : ''}`}>
              🔒 Vomit Draft Mode — previous text is locked.
            </div>
          </div>
        )}
        <button className="fs-goal-stop" onClick={stopGoal}>
          {progress?.done ? 'Dismiss' : 'End Vomit Draft Mode'}
        </button>
      </div>
    );
  }

  const startActive = () => {
    if (kind === 'time') { if (timeMode === 'until') startUntil(); else startTime(target); }
    else startCount();
  };
  const startDisabled = !goal && kind === 'time' && timeMode === 'until' && !/^\d{2}:\d{2}$/.test(untilTime);

  return (
    <div className="fs-goals">
      {/* v6.23, Derek: ONE Start at the top-left — it becomes Stop while a
          goal runs (Dismiss once it's done); the Header/Footer placement
          toggle shares the row, aligned right. */}
      <div className="fs-goal-toprow">
        <button
          className="fs-goal-start fs-goal-main"
          disabled={startDisabled}
          onClick={() => (goal ? stopGoal() : startActive())}
        >{goal ? (progress?.done ? 'Dismiss' : '■ Stop') : '▶ Start'}</button>
        <div className="fs-goal-showin">
          <span className="fs-goal-showin-label">Show in:</span>
          <span className="loc-group-toggle" role="group" aria-label="Where the goal readout shows">
            <button
              className={`locmap-tool-btn${goalShowIn === 'toolbar' ? ' loc-group-on' : ''}`}
              aria-pressed={goalShowIn === 'toolbar'}
              onClick={() => setGoalShowIn('toolbar')}
            >Header</button>
            <button
              className={`locmap-tool-btn${goalShowIn === 'footer' ? ' loc-group-on' : ''}`}
              aria-pressed={goalShowIn === 'footer'}
              onClick={() => setGoalShowIn('footer')}
            >Footer</button>
          </span>
        </div>
      </div>
      {progressBlock}

      {kind === 'time' ? (
        <>
          {/* v1.93: pick ONE of the two timed shapes, then one Start.
              (v1.85 kept Write-until first; that order survives.) */}
          <label className={`fs-goal-timemode${timeMode === 'until' ? ' active' : ''}`}>
            <input
              type="radio"
              name="fs-goal-timemode"
              checked={timeMode === 'until'}
              onChange={() => setTimeMode('until')}
            />
            <span className="fs-goal-timemode-label">Write until</span>
            <span onPointerDown={() => setTimeMode('until')}>
              <TimeField value={untilTime} onChange={setUntilTime} onEnter={startUntil} />
            </span>
          </label>
          <label className={`fs-goal-timemode${timeMode === 'for' ? ' active' : ''}`}>
            <input
              type="radio"
              name="fs-goal-timemode"
              checked={timeMode === 'for'}
              onChange={() => setTimeMode('for')}
            />
            <span className="fs-goal-timemode-label">Write for</span>
            <input
              type="number"
              min={1}
              value={target}
              onFocus={() => setTimeMode('for')}
              onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
            />
            <span>minutes</span>
          </label>
          <b className="fs-goal-quick-label">Quick start</b>
          <div className="fs-goal-quick">
            {[5, 15, 30, 60, 120].map((m) => (
              <button key={m} onClick={() => startTime(m)}>{m} min</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className={`fs-goal-timemode${countMode === 'reach' ? ' active' : ''}`}>
            <input
              type="radio"
              name="fs-goal-countmode"
              checked={countMode === 'reach'}
              onChange={() => setCountMode('reach')}
            />
            <span className="fs-goal-timemode-label">{kind === 'pages' ? 'Reach page:' : 'Reach word:'}</span>
            <input
              type="number"
              min={1}
              value={target}
              onFocus={() => setCountMode('reach')}
              onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
            />
            {/* v6.21, Derek: the CURRENT total rides the Reach row, right-
                aligned — you set an absolute target while looking at where
                the script stands. */}
            <span className="fs-goal-nowcount" title={`Current ${kind === 'pages' ? 'page count' : 'word count'}`}>
              {current.toLocaleString()}
            </span>
          </label>
          <label className={`fs-goal-timemode${countMode === 'relative' ? ' active' : ''}`}>
            <input
              type="radio"
              name="fs-goal-countmode"
              checked={countMode === 'relative'}
              onChange={() => setCountMode('relative')}
            />
            <span className="fs-goal-timemode-label">{kind === 'pages' ? 'Finish' : 'Write'}</span>
            <input
              type="number"
              min={1}
              value={relTargets[kind === 'pages' ? 'pages' : 'words']}
              onFocus={() => setCountMode('relative')}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1);
                setRelTargets((t) => ({ ...t, [kind]: v }));
              }}
            />
            <span>{kind === 'pages' ? 'Pages' : 'Words'}</span>
          </label>
          <b className="fs-goal-quick-label">Quick start</b>
          <div className="fs-goal-quick">
            {(kind === 'pages' ? [1, 2, 3, 5, 10] : [250, 500, 1000, 2000, 5000]).map((n) => (
              <button
                key={n}
                onClick={() => {
                  setGoal({ kind, target: n, mode: 'relative', baseline: current });
                  startLock(null);
                }}
              >{n.toLocaleString()} {kind === 'pages' ? (n === 1 ? 'page' : 'pages') : 'words'}</button>
            ))}
          </div>
          <p className="fs-goal-current">
            {countMode === 'relative'
              ? `Counts ${kind} written from when the goal starts — currently ${current.toLocaleString()} ${kind} total.`
              : `Counts the document total — currently ${current.toLocaleString()} ${kind}.`}
          </p>
        </>
      )}

      {/* v6.23: the FOOTER is just the Vomit checkbox — Show in moved to
          the top row. (v1.82: one checkbox that applies to whatever goal
          you start next.) */}
      <div className="fs-goal-footer">
        <label className="fs-goal-vomit" title="Lock previous text until the goal is done">
          <input
            type="checkbox"
            disabled={!editor}
            checked={vomitMode}
            onChange={(e) => setVomitMode(e.target.checked)}
          />
          <span>Vomit Draft Mode</span>
        </label>
      </div>
    </div>
  );
}
