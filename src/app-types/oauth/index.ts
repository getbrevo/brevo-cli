/**
 * The OAuth integration app type — the CLI's original and default app type.
 *
 * Detection is by ELIMINATION rather than by a positive marker: `app-config.json` has no
 * `appType` key, and an OAuth app is simply one with no `ui_app` block. That asymmetry is
 * deliberate (it is the wire's own discriminator, see `CLAUDE.md`), which is why both
 * predicates here are the negation of the UI module's.
 */
import { messages } from '../../lang/en';
import type { AppTypeModule } from '../contract';
import { isUiAppConfigShape, isUiAppRecordShape } from '../ui/detect';

export const oauthAppType: AppTypeModule = {
  id: 'oauth',
  label: messages.APP_TYPE_OAUTH,
  availability: 'ga',

  detectConfig: (config) => !isUiAppConfigShape(config),
  detectRecord: (app) => !isUiAppRecordShape(app),

  // Nothing type-specific to check locally. The OAuth checks `app upload` runs — at least
  // one redirect URL, and scope validation — are capability-driven rather than type-driven
  // (see `capabilities.ts`), so they stay in the command where their messages and exit codes
  // are asserted.
  validateConfig: () => {},

  // The server echoes an OAuth app's `auth` block as it stored it, and every key in it is
  // authored. Nothing is injected or stamped, so there is nothing to normalize away.
  wireOnlyKeys: [],
};
