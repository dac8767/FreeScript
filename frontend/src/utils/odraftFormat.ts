/**
 * ScriptCraft native format (.odraft) — import/export utilities.
 *
 * An .odraft file is a JSON document containing the script metadata and
 * TipTap content, designed for lossless round-tripping.
 */

import type { ScriptMeta } from '../services/api';
import { SCRIPT_EXT, scriptFileName } from './scriptFileExt';

interface OdraftFile {
  odraft_version: number;
  format: 'opendraft-script';
  exported_at: string;
  meta: {
    title: string;
    author: string;
    color: string;
    page_count: number;
  };
  content: Record<string, unknown>;
  /** v0.82: the project's custom themes travel with it, so another ScriptCraft
   *  can import them ("Import Themes from a Project"). Optional — files written
   *  before this simply have no themes to offer. */
  themes?: unknown[];
}

/** Build an .odraft JSON blob from script metadata and content. */
export function exportOdraft(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  themes?: unknown[],
): Blob {
  const data: OdraftFile = {
    odraft_version: 1,
    format: 'opendraft-script',
    exported_at: new Date().toISOString(),
    meta: {
      title: meta.title,
      author: meta.author,
      color: meta.color,
      page_count: meta.page_count,
    },
    content,
    ...(themes && themes.length ? { themes } : {}),
  };
  return new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
}

/** Download a script as an .odraft file. */
export async function downloadOdraft(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  themes?: unknown[],
): Promise<void> {
  const blob = exportOdraft(meta, content, themes);
  const text = await blob.text();
  const filename = scriptFileName(meta.title || 'Untitled');
  const { saveFile } = await import('./fileOps');
  await saveFile(text, filename, [{ name: 'ScriptCraft', extensions: [SCRIPT_EXT] }]);
}

/** The newest .odraft format revision this build understands. */
const ODRAFT_VERSION = 1;

/** Parse an .odraft JSON string back into meta + content (+ any bundled themes). */
export function parseOdraft(
  jsonText: string,
): { meta: { title: string; author: string; color: string; page_count: number }; content: Record<string, unknown>; themes?: unknown[] } {
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid .odraft file: not valid JSON');
  }

  // `null` is valid JSON — without this guard it used to escape the catch above
  // and crash on `data.format` with a raw TypeError instead of a friendly toast.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid .odraft file: unrecognized format');
  }
  /* v7.18: the LEGACY mirror copy. From v1.16 to v7.17 the Save As
     copy-in-a-folder wrote the bare TipTap document as `<title>.odraft.json`
     — no envelope. Every one of those files is a real script Derek may still
     have in the folder he chose, so they open: a doc node is unmistakable
     (`type: 'doc'` with a content array) and there is nothing else it could
     be. New saves write the envelope; this is for what is already on disk. */
  if (data.format === undefined && data.type === 'doc' && Array.isArray(data.content)) {
    return { meta: { title: '', author: '', color: '', page_count: 0 }, content: data };
  }
  if (data.format !== 'opendraft-script') {
    throw new Error('Invalid .odraft file: unrecognized format');
  }
  // Tolerate a hand-edited quoted version ("1"); reject anything non-numeric.
  const version = typeof data.odraft_version === 'string' && /^\d+$/.test(data.odraft_version)
    ? Number(data.odraft_version)
    : data.odraft_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('Invalid .odraft file: missing version');
  }
  if (version > ODRAFT_VERSION) {
    throw new Error('This .odraft file was made by a newer version of ScriptCraft — update the app to open it');
  }

  // v7.88 (security review D8): parseOdraft stays deliberately TOLERANT of the
  // content field (missing → {}, odd → as-is; pinned by odraftFormat.test.ts,
  // and legacy/hand-edited files rely on it). The silent-blank the review flags
  // is an EDITOR-render concern, not a parse one, and is fixed there:
  // ScreenplayEditor now sets enableContentCheck + onContentError, so content
  // that doesn't fit the schema tells the writer instead of blanking the page.
  return {
    meta: {
      // `??` not `||`: a deliberately-empty title round-trips as '' (the header
      // promises lossless round-tripping); only a MISSING title falls back.
      title: data.meta?.title ?? 'Untitled',
      author: data.meta?.author || '',
      color: data.meta?.color || '',
      page_count: data.meta?.page_count || 0,
    },
    content: data.content || {},
    // v0.82 travel-with-file themes: export writes them, so parse must hand
    // them back (ThemesTab used to re-parse the raw JSON to get at them).
    ...(Array.isArray(data.themes) && data.themes.length ? { themes: data.themes } : {}),
  };
}
