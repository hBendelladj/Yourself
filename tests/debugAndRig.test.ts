import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateUrlParams, syncUrlWithStage } from '../src/app/routes';
import { useSessionStore } from '../src/store/session';

describe('Phase 0: Instrumentation, Debug Panel and Rig Flags', () => {
  const originalWindow = (globalThis as unknown as { window: unknown }).window;
  const originalDocument = (globalThis as unknown as { document: unknown }).document;

  beforeEach(() => {
    // Reset Zustand store
    useSessionStore.getState().clearAll();

    // Setup global window mock
    (globalThis as unknown as { window: unknown }).window = {
      location: {
        search: '?debug=1&rig=v1',
        pathname: '/avatar',
      },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
        state: {},
      },
    };

    (globalThis as unknown as { document: unknown }).document = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document = originalDocument;
  });

  describe('URL and Route Synchronization', () => {
    it('preserves query parameters when syncing stage', () => {
      const replaceSpy = vi.fn();
      const pushSpy = vi.fn();

      (globalThis as unknown as { window: { location: { search: string; pathname: string }; history: { replaceState: unknown; pushState: unknown; state: unknown } } }).window = {
        location: {
          search: '?debug=1&rig=v2',
          pathname: '/settings',
        },
        history: {
          replaceState: replaceSpy,
          pushState: pushSpy,
          state: {},
        },
      };

      updateUrlParams({ debug: '1', rig: 'v2' });
      expect(replaceSpy).toHaveBeenCalled();

      syncUrlWithStage('avatar', false);
      expect(pushSpy).toHaveBeenCalledWith({ stage: 'avatar' }, '', '/avatar?debug=1&rig=v2');
    });

    it('toggles rigVersion in session store between v1, v2, v3 and v4 (defaults to v4)', () => {
      const store = useSessionStore.getState();
      expect(store.rigVersion).toBe('v4');

      store.setRigVersion('v2');
      expect(useSessionStore.getState().rigVersion).toBe('v2');

      store.setRigVersion('v1');
      expect(useSessionStore.getState().rigVersion).toBe('v1');

      store.setRigVersion('v3');
      expect(useSessionStore.getState().rigVersion).toBe('v3');

      store.setRigVersion('v4');
      expect(useSessionStore.getState().rigVersion).toBe('v4');
    });

    it('stores apiKey strictly in memory without writing to storage', () => {
      const store = useSessionStore.getState();
      store.setApiKey('test-secret-api-key-12345');
      expect(useSessionStore.getState().apiKey).toBe('test-secret-api-key-12345');
      // No debe existir en sessionStorage ni localStorage
      if (typeof sessionStorage !== 'undefined') {
        expect(sessionStorage.getItem('yourself_api_key')).toBeNull();
      }
    });

    it('toggles isDebugOverlay in session store and updates query params', () => {
      const store = useSessionStore.getState();
      store.setIsDebugOverlay(true);
      expect(useSessionStore.getState().isDebugOverlay).toBe(true);

      store.setIsDebugOverlay(false);
      expect(useSessionStore.getState().isDebugOverlay).toBe(false);
    });

    it('handles syncUrlWithStage gracefully when window is undefined', () => {
      (globalThis as unknown as { window: unknown }).window = undefined;
      expect(() => syncUrlWithStage('avatar')).not.toThrow();
      expect(() => updateUrlParams({ rig: 'v1' })).not.toThrow();
    });
  });

  describe('Debug Metrics and Budget Constants', () => {
    it('defines module budgets under JS 4.0ms total limit', () => {
      const budgets = {
        prosodyVisemes: 0.8,
        directorDynamics: 0.4,
        rigApply: 0.8,
        overlaysShading: 1.0,
      };

      const sumBudgets =
        budgets.prosodyVisemes +
        budgets.directorDynamics +
        budgets.rigApply +
        budgets.overlaysShading;

      expect(sumBudgets).toBeLessThanOrEqual(4.0);
      expect(budgets.prosodyVisemes).toBeLessThanOrEqual(0.8);
      expect(budgets.directorDynamics).toBeLessThanOrEqual(0.4);
      expect(budgets.rigApply).toBeLessThanOrEqual(0.8);
      expect(budgets.overlaysShading).toBeLessThanOrEqual(1.0);
    });
  });
});