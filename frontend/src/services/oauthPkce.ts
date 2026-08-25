/**
 * oauthPkce — shared PKCE (Proof Key for Code Exchange) OAuth flow for the
 * Save Locations integrations (Google Drive, OneDrive).
 *
 * Flow: open the provider's auth URL in a popup with a code challenge; the
 * popup lands on our /oauth-callback route, which posts the code back via
 * postMessage; we exchange it for tokens directly from the browser (both
 * Google and Microsoft support CORS token exchange for public PKCE clients).
 * Tokens are cached in localStorage and refreshed when expired.
 */

import { secureGet, secureSet, secureDelete } from './secureStore';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const raw = new Uint8Array(48);
  crypto.getRandomValues(raw);
  const verifier = b64url(raw.buffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

export function redirectUri(): string {
  return `${window.location.origin}/oauth-callback`;
}

/** Open the auth popup and resolve with the authorization code. */
function waitForCode(authUrl: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'oauth', 'width=520,height=680');
    if (!popup) { reject(new Error('Popup blocked — allow popups for this site and try again')); return; }
    let settled = false;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'oauth-callback') return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      if (d.error) reject(new Error(String(d.error)));
      else if (d.state !== expectedState) reject(new Error('OAuth state mismatch'));
      else resolve(String(d.code));
    };
    window.addEventListener('message', onMessage);
    const closedTimer = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(closedTimer);
        reject(new Error('Sign-in window was closed'));
      }
    }, 500);
  });
}

export interface ProviderConfig {
  /** localStorage key for the cached token set */
  storageKey: string;
  authEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
  /** extra auth-URL params (e.g. Google's access_type=offline) */
  extraAuthParams?: Record<string, string>;
}

/* v7.90 (security review D9): the SECRET token set now lives in the OS keychain
   (secureStore), not plaintext localStorage. A non-secret presence marker stays
   in localStorage so the UI's synchronous "connected?" check needn't await the
   keychain. */
const markerKey = (storageKey: string) => `${storageKey}:present`;

/** SYNC: is a token set stored for this provider? Reads the marker, and treats
 *  a legacy plaintext blob (≤ v7.89) as present until it migrates. */
export function tokensPresent(storageKey: string): boolean {
  try {
    return !!localStorage.getItem(markerKey(storageKey)) || !!localStorage.getItem(storageKey);
  } catch { return false; }
}

/** ASYNC: the secret token set, from the keychain. On first read it migrates a
 *  legacy plaintext localStorage blob into the keychain and deletes the copy on
 *  disk, so existing users' tokens move off disk transparently. */
export async function loadTokens(storageKey: string): Promise<TokenSet | null> {
  try {
    const raw = await secureGet(storageKey);
    if (raw) {
      const t = JSON.parse(raw) as TokenSet;
      if (t && t.accessToken) return t;
    }
  } catch { /* fall through to the legacy path */ }

  try {
    const legacy = localStorage.getItem(storageKey);
    if (legacy) {
      const t = JSON.parse(legacy) as TokenSet;
      if (t && t.accessToken) {
        await saveTokens(storageKey, t);                 // → keychain + marker
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
        return t;
      }
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null;
}

export async function clearTokens(storageKey: string): Promise<void> {
  try { await secureDelete(storageKey); } catch { /* ignore */ }
  try { localStorage.removeItem(markerKey(storageKey)); } catch { /* ignore */ }
  try { localStorage.removeItem(storageKey); } catch { /* ignore */ } // legacy plaintext
}

async function saveTokens(storageKey: string, t: TokenSet): Promise<void> {
  try { await secureSet(storageKey, JSON.stringify(t)); } catch { /* ignore */ }
  try { localStorage.setItem(markerKey(storageKey), '1'); } catch { /* ignore */ }
}

/** v7.90: proactively move any legacy plaintext tokens off disk into the
 *  keychain at startup, rather than waiting for the next cloud save. Idempotent. */
export async function migrateOAuthTokensToKeychain(storageKeys: string[]): Promise<void> {
  for (const k of storageKeys) {
    try { await loadTokens(k); } catch { /* ignore */ }
  }
}

async function tokenRequest(cfg: ProviderConfig, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const prev = await loadTokens(cfg.storageKey);
  const tokens: TokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || prev?.refreshToken,
    expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000,
  };
  await saveTokens(cfg.storageKey, tokens);
  return tokens;
}

/** Interactive sign-in via popup. */
export async function connect(cfg: ProviderConfig): Promise<TokenSet> {
  if (!cfg.clientId.trim()) throw new Error('No client ID configured — paste one in Settings first');
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const params = new URLSearchParams({
    client_id: cfg.clientId.trim(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: cfg.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(cfg.extraAuthParams || {}),
  });
  const code = await waitForCode(`${cfg.authEndpoint}?${params.toString()}`, state);
  return tokenRequest(cfg, {
    client_id: cfg.clientId.trim(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
}

/** Returns a valid access token, refreshing silently when possible.
 *  Throws when not connected — callers surface that as a save-location error. */
export async function getAccessToken(cfg: ProviderConfig): Promise<string> {
  const t = await loadTokens(cfg.storageKey);
  if (!t) throw new Error('Not connected — open Settings → Save Locations and connect');
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) throw new Error('Session expired — reconnect in Settings → Save Locations');
  const fresh = await tokenRequest(cfg, {
    client_id: cfg.clientId.trim(),
    grant_type: 'refresh_token',
    refresh_token: t.refreshToken,
  });
  return fresh.accessToken;
}
