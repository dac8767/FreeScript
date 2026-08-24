import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import AppErrorBoundary from './components/AppErrorBoundary.tsx';
import { initStorage } from './services/api';

// v7.89 (security review D14): a global safety net for errors that escape
// React's render boundary — a throw in an async handler, a setTimeout, an
// unawaited promise. index.html catches these BEFORE the app boots (the
// "failed to start" overlay); afterwards they only reached the console, so a
// wedged background failure was invisible. Now the writer gets a quiet,
// throttled recovery toast. Registered at module load so it is armed as early
// as possible; the toast itself only appears once the app (and its toast host)
// has mounted.
let lastGlobalErrorToast = 0;
function surfaceGlobalError(kind: string, detail: unknown) {
  console.error(`[${kind}]`, detail);
  const now = Date.now();
  if (now - lastGlobalErrorToast < 8000) return; // don't storm the writer
  lastGlobalErrorToast = now;
  void import('./components/Toast')
    .then(({ showToast }) =>
      showToast(
        'Something went wrong in the background. Your work is safe — if the app misbehaves, reload the window.',
        'error',
      ),
    )
    .catch(() => {});
}
window.addEventListener('unhandledrejection', (e) => surfaceGlobalError('unhandledrejection', e.reason));
window.addEventListener('error', (e) => {
  // Only real uncaught exceptions — a failed image/resource load has no `error`
  // and must not raise a scary toast.
  if (e.error) surfaceGlobalError('error', e.error);
});

async function init() {
  // Apply saved theme before first render to avoid flash. A CUSTOM theme is a
  // base + variable overrides, so setting data-theme alone wouldn't restore it
  // — applyThemeToDom re-injects the variables (v0.78).
  const savedTheme = localStorage.getItem('opendraft:theme') || 'dark';
  if (savedTheme.startsWith('custom:')) {
    const { applyThemeToDom } = await import('./components/themes');
    const { useThemeStore } = await import('./stores/themeStore');
    applyThemeToDom(savedTheme, useThemeStore.getState().customThemes);
  } else {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  // v1.60: restore the remembered window bounds (Settings > General) and keep
  // recording them. No-op outside Tauri.
  {
    const { initWindowMemory } = await import('./services/windowMemory');
    void initWindowMemory();
  }

  // Android needs viewport-fit=cover and explicit safe-area padding
  if (/android/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('android');
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', vp.getAttribute('content') + ', viewport-fit=cover');
  }

  // Track the visual viewport height as a CSS variable so dialogs/overlays can
  // shrink when the soft keyboard appears. Android WebView's `dvh` unit is
  // unreliable for keyboard insets, but `visualViewport.height` is accurate.
  const updateViewportHeight = () => {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--vv-height', `${h}px`);
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportHeight);
    window.visualViewport.addEventListener('scroll', updateViewportHeight);
  }
  window.addEventListener('resize', updateViewportHeight);
  updateViewportHeight();

  // On Tauri (desktop + mobile) this swaps the HTTP api with local SQLite.
  // On web it is a no-op — the Python backend is used as-is.
  // initStorage() handles its own timeout and fallback internally —
  // no additional wrapping needed here.
  await initStorage();

  // Set initial native window title on desktop (for macOS Window menu)
  import('./services/platform').then(({ isDesktopTauri }) => {
    if (!isDesktopTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_window_title', { title: 'Untitled Script' }).catch(() => {});
    });
  });

  // Clear the loading-timeout diagnostic (and remove overlay if it fired early)
  if ((window as any)._renderTimeout) clearTimeout((window as any)._renderTimeout);
  const fatalOverlay = document.getElementById('_fatal');
  if (fatalOverlay) fatalOverlay.remove();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </StrictMode>,
  );
}

init().catch((err) => {
  console.error('Fatal init error:', err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#1a1a2e;color:#ff6b6b;font:14px/1.6 monospace;padding:40px;white-space:pre-wrap;';
  d.textContent = 'ScriptCraft failed to start:\n\n' + (err?.stack || err?.message || String(err));
  document.body.appendChild(d);
});
