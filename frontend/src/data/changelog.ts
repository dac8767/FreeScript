import CHANGELOG_DATA from './changelog.json';

/**
 * Changelog (v0.82).
 *
 * Nothing generates this automatically — it's a hand-written list, and it had
 * been left frozen at v0.19 (inherited from the fork), which is why none of the
 * recent work appeared. Entries are added HERE, as part of the change that
 * makes them true. Newest first.
 */

/* ── Tags (v1.56) ──────────────────────────────────────────────────────────
   Every changelog item wears one or two colored tags so the list can be
   scanned. Curated entries set `tags` explicitly; anything without them is
   classified by inferTags() below — ONE classifier, so the backfilled
   history and future omissions are tagged by the same rules. */
export type ChangeTag =
  | 'New Feature' | 'Fix' | 'UI' | 'Editor' | 'Saving' | 'Tools' | 'Branding' | 'Polish';

export const TAG_META: Record<ChangeTag, { color: string }> = {
  'New Feature': { color: '#6abf69' },
  'Fix':         { color: '#e06060' },
  'UI':          { color: '#6fa8dc' },
  'Editor':      { color: '#b58ee0' },
  'Saving':      { color: '#e89b4f' },
  'Tools':       { color: '#4cbfbf' },
  'Branding':    { color: '#d377b0' },
  'Polish':      { color: '#9a9a9a' },
};

export const ALL_TAGS = Object.keys(TAG_META) as ChangeTag[];

const TAG_RULES: [RegExp, ChangeTag][] = [
  [/\bfix|bug|broke|regress|crash|wrong|dead|clip|misalign|stale|orphan|actually|no longer|stops?\b/i, 'Fix'],
  [/save|export|import|\bfile\b|folder|location|draft|version|autosave|\.odraft|snapshot/i, 'Saving'],
  [/scriptcraft|freedraft|opendraft|brand|renam/i, 'Branding'],
  [/notes?\b|to-?do|snippet|outline|analytic|character|location tool|spell|navigator|title page|index cards|goals|tags panel|dev picker|workspace/i, 'Tools'],
  [/placeholder|element|action|scene|dialogue|pagination|\bpage\b|cursor|caret|dual/i, 'Editor'],
  [/\bnew\b|adds?\b|introduc/i, 'New Feature'],
  [/menu|dialog|toolbar|icon|chevron|spacing|padding|align|colou?r|theme|font|divider|bubble|chip|header|footer|window|panel|zoom|layout|customize|button|resiz/i, 'UI'],
];

export function inferTags(text: string): ChangeTag[] {
  const out: ChangeTag[] = [];
  for (const [re, tag] of TAG_RULES) {
    if (out.length >= 2) break;
    if (re.test(text) && !out.includes(tag)) out.push(tag);
  }
  return out.length ? out : ['Polish'];
}

export interface ChangelogItem {
  title: string;
  detail: string;
  /** Explicit tags win; absent means inferTags(title + detail) applies. */
  tags?: ChangeTag[];
}

export function tagsFor(item: ChangelogItem): ChangeTag[] {
  return item.tags && item.tags.length ? item.tags : inferTags(`${item.title} ${item.detail}`);
}

export interface ChangelogEntry {
  version: string;
  /** v1.55: release date (YYYY-MM-DD). Older entries predate the field. */
  date?: string;
  items: ChangelogItem[];
}

export const APP_VERSION = '7.78';

/* v4.73 — THE "What's New" CRASH (Derek's screenshot, ChangelogDialog map).
   changelog.json holds TWO shapes: the curated era uses
   `items: [{title, detail}]`, while every entry since v4.53 was appended as
   `changes: ["one string", …]`. The old export was a blind cast, so the
   dialog's `entry.items.filter` threw on the first changes-shaped entry the
   moment the window opened. Normalize BOTH shapes here — the dialog keeps
   one contract, and future entries may use either. A changes string splits
   into title — detail at its first ": " (or " — ") so the list still reads
   scannable; no split point means the whole line is the title. */
interface RawEntry {
  version: string;
  date?: string;
  items?: ChangelogItem[];
  changes?: string[];
}

function itemFromString(s: string): ChangelogItem {
  const colon = s.indexOf(': ');
  if (colon > 0 && colon <= 48) {
    return { title: s.slice(0, colon), detail: s.slice(colon + 2) };
  }
  const dash = s.indexOf(' — ');
  if (dash > 0 && dash <= 64) {
    return { title: s.slice(0, dash), detail: s.slice(dash + 3) };
  }
  return { title: s, detail: '' };
}

export const CHANGELOG: ChangelogEntry[] = (CHANGELOG_DATA as unknown as RawEntry[]).map((e) => ({
  version: e.version,
  date: e.date,
  items: e.items ?? (e.changes ?? []).map(itemFromString),
}));
