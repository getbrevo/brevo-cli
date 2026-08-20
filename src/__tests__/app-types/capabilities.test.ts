import {
  assertCapability,
  capabilitiesFor,
  supports,
  type Capability,
  type Distribution,
} from '../../app-types/capabilities';
import { APP_TYPES, resolveFromConfig, resolveFromRecord } from '../../app-types';
import { CliError } from '../../lib/errors';
import type { AppTypeId } from '../../app-types/contract';

const TYPES: AppTypeId[] = ['oauth', 'ui'];
const DISTRIBUTIONS: Distribution[] = ['private', 'public'];

describe('capability matrix', () => {
  // The invariant that lets `app submit`'s gate be routed through the matrix without
  // changing behaviour. Its shipped check is literally `distribution_type !== 'public'`,
  // so review-lifecycle must be supported for EXACTLY the public combinations — for every
  // app type, including ones added later. If this fails, submit.ts's message and exit code
  // have changed for someone.
  it('supports review-lifecycle exactly when the distribution is public', () => {
    for (const type of TYPES) {
      expect(supports(type, 'public', 'review-lifecycle')).toBe(true);
      expect(supports(type, 'private', 'review-lifecycle')).toBe(false);
    }
  });

  // A UI app has no OAuth block at all — no client_id, no callbacks, nothing issued for it —
  // so none of the OAuth-shaped features may leak into its row of the table.
  it('grants a UI app no OAuth capabilities in either distribution', () => {
    const oauthShaped: Capability[] = ['oauth-flow', 'redirect-uris', 'scaffold-feature'];
    for (const distribution of DISTRIBUTIONS) {
      for (const capability of oauthShaped) {
        expect(supports('ui', distribution, capability)).toBe(false);
      }
    }
  });

  // account-install is the UI app's one lifecycle verb, and `app install` is documented as
  // UI-only. An OAuth app gaining it would make that documentation wrong.
  it('grants account-install to UI apps only', () => {
    for (const distribution of DISTRIBUTIONS) {
      expect(supports('ui', distribution, 'account-install')).toBe(true);
      expect(supports('oauth', distribution, 'account-install')).toBe(false);
    }
  });

  // Distribution only ever ADDS capabilities. A private app losing something a public one
  // has (other than the review lifecycle) would be a surprise worth failing on.
  it('makes public a superset of private for every type', () => {
    for (const type of TYPES) {
      for (const capability of capabilitiesFor(type, 'private')) {
        expect(supports(type, 'public', capability)).toBe(true);
      }
    }
  });

  it('never lists a capability twice', () => {
    for (const type of TYPES) {
      for (const distribution of DISTRIBUTIONS) {
        const caps = capabilitiesFor(type, distribution);
        expect(new Set(caps).size).toBe(caps.length);
      }
    }
  });
});

describe('assertCapability', () => {
  it('throws the caller-supplied message when the capability is missing', () => {
    expect(() =>
      assertCapability('ui', 'private', 'review-lifecycle', 'App 42 is not public.'),
    ).toThrow(CliError);
    expect(() =>
      assertCapability('ui', 'private', 'review-lifecycle', 'App 42 is not public.'),
    ).toThrow('App 42 is not public.');
  });

  it('does not throw when the capability is present', () => {
    expect(() => assertCapability('oauth', 'public', 'review-lifecycle', 'unused')).not.toThrow();
  });
});

describe('app-type registry', () => {
  it('resolves a config with a ui_app block to the ui type, anything else to oauth', () => {
    expect(resolveFromConfig({ ui_app: { extension_type: 'actionLink' } as never }).id).toBe('ui');
    expect(resolveFromConfig({}).id).toBe('oauth');
    expect(resolveFromConfig(null).id).toBe('oauth');
    expect(resolveFromConfig(undefined).id).toBe('oauth');
  });

  // The record path is weaker than the config path on purpose: the list endpoint echoes no
  // ui_app block today, so it falls back to the absence of every piece of OAuth material.
  // A record with a client_id but no callbacks stays a (half-configured) OAuth app.
  it('resolves a record by its echoed block, else by the absence of OAuth material', () => {
    expect(resolveFromRecord({ ui_app: { extension_type: 'actionLink' } as never }).id).toBe('ui');
    expect(resolveFromRecord({ client_id: '', redirect_uris: null }).id).toBe('ui');
    expect(resolveFromRecord({ client_id: '' }).id).toBe('ui');
    expect(resolveFromRecord({ client_id: 'abc', redirect_uris: null }).id).toBe('oauth');
    expect(resolveFromRecord({ client_id: '', redirect_uris: ['https://x.example.com'] }).id).toBe(
      'oauth',
    );
    expect(resolveFromRecord(null).id).toBe('oauth');
  });

  it('keys every module by its own id', () => {
    for (const [id, module] of Object.entries(APP_TYPES)) {
      expect(module.id).toBe(id);
    }
  });

  // Only the ui type declares server-stamped keys today, and `app upload` reads that list
  // through the registry. An OAuth app must declare none, or the upload diff would start
  // normalizing away fields a partner authored.
  it('declares wire-only keys for the ui type and none for oauth', () => {
    expect(APP_TYPES.oauth.wireOnlyKeys).toEqual([]);
    expect([...APP_TYPES.ui.wireOnlyKeys].sort()).toEqual([
      'extension_point_name',
      'link_target',
      'version',
    ]);
  });

  it('marks both types as GA', () => {
    expect(APP_TYPES.oauth.availability).toBe('ga');
    expect(APP_TYPES.ui.availability).toBe('ga');
  });
});
