/**
 * secureStore (v7.90, security review D9) — a small async key/value for SECRETS
 * that must not sit in the webview's plaintext localStorage: the Google Drive
 * and OneDrive OAuth tokens.
 *
 * Desktop (Tauri) routes to the OS keychain via the Rust keychain_* commands
 * (macOS Keychain / Windows Credential Manager / Linux Secret Service). On the
 * web build — and on mobile, which has no desktop keychain crate — it falls
 * back to localStorage, which is the best storage reachable there anyway.
 *
 * It is async by nature (the keychain is an IPC round trip); callers that need
 * a synchronous "is this connected?" check use a non-secret presence marker in
 * localStorage instead (see oauthPkce.ts), never this.
 */
import { isDesktopTauri } from './platform';

export async function secureSet(key: string, value: string): Promise<void> {
  if (isDesktopTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('keychain_set', { key, value });
    return;
  }
  localStorage.setItem(key, value);
}

export async function secureGet(key: string): Promise<string | null> {
  if (isDesktopTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('keychain_get', { key })) ?? null;
  }
  return localStorage.getItem(key);
}

export async function secureDelete(key: string): Promise<void> {
  if (isDesktopTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('keychain_delete', { key });
    return;
  }
  localStorage.removeItem(key);
}
