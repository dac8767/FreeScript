// @vitest-environment jsdom
/**
 * oauthPkce token storage (v7.90, security review D9).
 *
 * The security property: the secret token set lives in the OS keychain, and a
 * legacy plaintext token in localStorage is migrated INTO the keychain and
 * deleted from disk on first read. secureStore is mocked as an in-memory
 * "keychain" distinct from localStorage so the migration is observable (on the
 * real web build the two collapse to localStorage, which is expected).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mem = new Map<string, string>();
vi.mock('./secureStore', () => ({
  secureGet: vi.fn(async (k: string) => mem.get(k) ?? null),
  secureSet: vi.fn(async (k: string, v: string) => { mem.set(k, v); }),
  secureDelete: vi.fn(async (k: string) => { mem.delete(k); }),
}));

import { loadTokens, clearTokens, tokensPresent, migrateOAuthTokensToKeychain } from './oauthPkce';

const KEY = 'opendraft:gdriveTokens';
const token = () => ({ accessToken: 'a-token', refreshToken: 'r-token', expiresAt: Date.now() + 3_600_000 });

beforeEach(() => {
  mem.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('oauthPkce token storage (D9)', () => {
  it('reads a token set from the keychain', async () => {
    mem.set(KEY, JSON.stringify(token()));
    const t = await loadTokens(KEY);
    expect(t?.accessToken).toBe('a-token');
  });

  it('migrates a legacy plaintext token into the keychain and deletes it from disk', async () => {
    localStorage.setItem(KEY, JSON.stringify(token()));   // legacy ≤v7.89 plaintext
    expect(tokensPresent(KEY)).toBe(true);                 // legacy blob counts as present

    const t = await loadTokens(KEY);
    expect(t?.accessToken).toBe('a-token');                // returned
    expect(mem.get(KEY)).toBeTruthy();                     // now in the keychain
    expect(localStorage.getItem(KEY)).toBeNull();          // plaintext removed from disk
    expect(localStorage.getItem(`${KEY}:present`)).toBe('1'); // sync marker set
    expect(tokensPresent(KEY)).toBe(true);
  });

  it('migrateOAuthTokensToKeychain moves everything off disk up front', async () => {
    localStorage.setItem(KEY, JSON.stringify(token()));
    await migrateOAuthTokensToKeychain([KEY]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mem.get(KEY)).toBeTruthy();
  });

  it('clearTokens removes the keychain entry, the marker, and any legacy blob', async () => {
    mem.set(KEY, JSON.stringify(token()));
    localStorage.setItem(`${KEY}:present`, '1');
    await clearTokens(KEY);
    expect(mem.has(KEY)).toBe(false);
    expect(localStorage.getItem(`${KEY}:present`)).toBeNull();
    expect(tokensPresent(KEY)).toBe(false);
    expect(await loadTokens(KEY)).toBeNull();
  });

  it('tokensPresent is false when nothing is stored', () => {
    expect(tokensPresent(KEY)).toBe(false);
  });
});
