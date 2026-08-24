// @vitest-environment jsdom
/**
 * external.ts — the shared external-link opener (v7.84, security review D2).
 *
 * The one behaviour worth pinning is the scheme guard: a link can arrive from
 * an OPENED script's note (untrusted content), so openInBrowser must refuse
 * anything that isn't http/https before it reaches any opener. These tests
 * drive the WEB path (jsdom reports no Tauri, so window.open is the sink) —
 * the same guard runs before the desktop plugin call, so proving it here
 * proves it for both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openInBrowser } from './external';

describe('openInBrowser scheme guard', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens an https URL in a new tab with noopener,noreferrer', () => {
    openInBrowser('https://example.com/help');
    expect(openSpy).toHaveBeenCalledWith('https://example.com/help', '_blank', 'noopener,noreferrer');
  });

  it('opens a plain http URL', () => {
    openInBrowser('http://example.com');
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a javascript: URL', () => {
    openInBrowser('javascript:alert(document.cookie)');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('refuses a file: URL', () => {
    openInBrowser('file:///etc/passwd');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('refuses a data: URL', () => {
    openInBrowser('data:text/html,<script>alert(1)</script>');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('refuses a scheme-relative or bare string that could resolve oddly', () => {
    openInBrowser('//evil.example.com');
    openInBrowser('not a url');
    expect(openSpy).not.toHaveBeenCalled();
  });
});
