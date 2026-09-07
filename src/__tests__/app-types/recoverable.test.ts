import { APP_TYPES, appTypeById, resolveFromRecord } from '../../app-types';
import type { AppRecordLike, AppTypeId } from '../../app-types/contract';
import type { OAuthApp } from '../../types';

const TYPES: AppTypeId[] = ['oauth', 'ui', 'function'];

/**
 * `recoverableFromRecord` answers the question `brevo app scaffold`'s no-config branch has
 * to ask before it writes anything: can a complete `app-config.json` be rebuilt from this
 * server record alone?
 *
 * It exists because the answer is type-dependent and the difference is invisible. An OAuth
 * app's whole configuration lives on the app record, so the answer is always yes. A UI app's
 * lives in its `ui_app` block, which the read endpoint sources from the latest
 * `app_versions` snapshot — so an app created but never uploaded comes back with no block at
 * all, and there is nothing to write.
 *
 * Getting that wrong is silent, not loud: `ui_app`'s presence IS the app-type discriminator,
 * so a recovered config missing the block reads as a perfectly valid OAuth app, and the next
 * `app upload` pushes an `auth` block where `ui_app` belonged.
 */
describe('recoverableFromRecord', () => {
  const oauthRecord: AppRecordLike = {
    client_id: 'client-1',
    redirect_uris: ['https://example.com/cb'],
  };

  const uiRecordWithSnapshot: AppRecordLike = {
    client_id: '',
    redirect_uris: null,
    ui_app: {
      extension_type: 'actionLink',
      label: 'Do the thing',
      surface_point_list: [{ surface_point_name: 'contact-details-header-menu' }],
    } as OAuthApp['ui_app'],
  };

  // The never-uploaded UI app: `isUiAppRecordShape`'s fallback still classifies it as a UI
  // app (no client_id, no callbacks), but there is no block to recover.
  const uiRecordNoSnapshot: AppRecordLike = {
    client_id: '',
    redirect_uris: null,
  };

  it('is declared by every app type', () => {
    for (const type of TYPES) {
      expect(typeof appTypeById(type).recoverableFromRecord).toBe('function');
    }
  });

  it('reports an OAuth record as recoverable — its config is all on the record', () => {
    expect(APP_TYPES.oauth.recoverableFromRecord(oauthRecord)).toBe(true);
  });

  // Even with no callbacks and no scopes: an OAuth app with nothing configured yet
  // recovers to a config with the scaffold's own defaults, which is what `app create`
  // would have written anyway.
  it('reports a bare OAuth record as recoverable', () => {
    expect(APP_TYPES.oauth.recoverableFromRecord({ client_id: 'client-4' })).toBe(true);
  });

  it('reports a UI record carrying its ui_app block as recoverable', () => {
    expect(APP_TYPES.ui.recoverableFromRecord(uiRecordWithSnapshot)).toBe(true);
  });

  it('reports a UI record with no ui_app block as unrecoverable', () => {
    expect(APP_TYPES.ui.recoverableFromRecord(uiRecordNoSnapshot)).toBe(false);
  });

  it('reports a Function record as always recoverable — brevo_function is static', () => {
    expect(APP_TYPES.function.recoverableFromRecord({ brevo_function: {} })).toBe(true);
  });

  it('reports a null record as unrecoverable for every type', () => {
    for (const type of TYPES) {
      expect(appTypeById(type).recoverableFromRecord(null)).toBe(false);
      expect(appTypeById(type).recoverableFromRecord(undefined)).toBe(false);
    }
  });

  // The pull path resolves the type from the record and then asks that type whether it can
  // be recovered. This asserts the two agree, which is the whole point of hanging the
  // question off the registry instead of testing for `ui_app` inline in the command.
  describe('composed with resolveFromRecord', () => {
    it('routes a never-uploaded UI app to the UI type, which refuses it', () => {
      const type = resolveFromRecord(uiRecordNoSnapshot);
      expect(type.id).toBe('ui');
      expect(type.recoverableFromRecord(uiRecordNoSnapshot)).toBe(false);
    });

    it('routes an uploaded UI app to the UI type, which accepts it', () => {
      const type = resolveFromRecord(uiRecordWithSnapshot);
      expect(type.id).toBe('ui');
      expect(type.recoverableFromRecord(uiRecordWithSnapshot)).toBe(true);
    });

    it('routes an OAuth app to the OAuth type, which accepts it', () => {
      const type = resolveFromRecord(oauthRecord);
      expect(type.id).toBe('oauth');
      expect(type.recoverableFromRecord(oauthRecord)).toBe(true);
    });

    // A half-configured OAuth app (client_id issued, callbacks not set yet) must not be
    // mistaken for a UI app and refused — `isUiAppRecordShape` requires BOTH to be empty,
    // and this asserts the recoverability question inherits that.
    it('accepts a half-configured OAuth app rather than refusing it as a UI app', () => {
      const halfConfigured: AppRecordLike = {
        client_id: 'client-5',
        redirect_uris: null,
      };
      const type = resolveFromRecord(halfConfigured);
      expect(type.id).toBe('oauth');
      expect(type.recoverableFromRecord(halfConfigured)).toBe(true);
    });
  });
});
