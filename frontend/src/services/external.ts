/**
 * External links (v3.12) — ONE opener and ONE donate URL, shared by the Help
 * menu, the titlebar's donate button and the Notes link previews. Desktop
 * routes through tauri-plugin-opener (default browser); web falls back to
 * window.open.
 *
 * v7.84 (security review D2) — this used to invoke a hand-rolled `open_url`
 * Rust command that shelled out through `cmd /C start "" <url>` on Windows.
 * `cmd` re-parses `& | ^`, so a link like `https://x/&calc.exe` in a note of
 * an opened script executed a program on click. It now goes through the SAME
 * opener plugin File ▸ Print already uses (openPath) — no shell in the middle,
 * and the opener capability is scoped to http/https/mailto/tel. The scheme is
 * also checked here, because a link in an opened file is untrusted content.
 */
import { isTauri } from './platform';

export const DONATE_URL = 'https://buymeacoffee.com/derektor';

export const openInBrowser = (url: string): void => {
  if (!/^https?:\/\//i.test(url)) {
    console.error('Refusing to open non-http(s) URL:', url);
    return;
  }
  if (isTauri()) {
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
      openUrl(url).catch((err: unknown) => console.error('Failed to open URL:', err));
    });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};
