import { describe, it, expect } from 'vitest';
import { normalizePath, syncUrlWithStage } from '../src/app/routes';

describe('App Routing (/settings <-> /avatar)', () => {
  it('normalizes paths correctly', () => {
    expect(normalizePath('/settings')).toBe('/settings');
    expect(normalizePath('/avatar')).toBe('/avatar');
    expect(normalizePath('/AVATAR')).toBe('/avatar');
    expect(normalizePath('/')).toBe('/settings');
    expect(normalizePath('/unknown')).toBe('/settings');
  });

  it('syncs URL stage without throwing in node or browser', () => {
    expect(() => syncUrlWithStage('setup')).not.toThrow();
    expect(() => syncUrlWithStage('avatar')).not.toThrow();
  });
});
