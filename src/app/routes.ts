/**
 * routes.ts
 *
 * Enrutamiento simple del cliente (100% estático):
 * - /settings: Panel de configuración inicial (nombre, voz, foto, API key).
 * - /avatar: Escenario del avatar animado con Three.js y conversación de voz.
 * - Sincroniza el historial del navegador mediante HTML5 History API (pushState/replaceState y popstate).
 */

export type AppRoute = '/settings' | '/avatar';

export function normalizePath(pathname: string): AppRoute {
  if (pathname.toLowerCase() === '/avatar') {
    return '/avatar';
  }
  return '/settings';
}

export function syncUrlWithStage(stage: 'setup' | 'avatar', replace = false): void {
  if (typeof window === 'undefined') return;

  const targetPath: AppRoute = stage === 'avatar' ? '/avatar' : '/settings';

  if (window.location.pathname !== targetPath) {
    const searchParams = new URLSearchParams(window.location.search);
    if (stage === 'avatar' && !searchParams.has('rig')) {
      searchParams.set('v4', '');
      searchParams.set('rig', 'v4');
    }
    const queryString = searchParams.toString();
    const targetUrl = targetPath + (queryString ? `?${queryString}` : '');
    if (replace) {
      window.history.replaceState({ stage }, '', targetUrl);
    } else {
      window.history.pushState({ stage }, '', targetUrl);
    }
  }
}

/**
 * Actualiza los parámetros de consulta (?key=val) en la URL sin recargar la página
 */
export function updateUrlParams(params: Record<string, string | null | undefined>): void {
  if (typeof window === 'undefined') return;
  const searchParams = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      searchParams.delete(key);
    } else {
      searchParams.set(key, value);
    }
  }
  const queryString = searchParams.toString();
  const newUrl = window.location.pathname + (queryString ? `?${queryString}` : '');
  window.history.replaceState(window.history.state, '', newUrl);
}
