/**
 * The Brevo Function app type.
 *
 * A Function app sends `brevo_function: {}` on the wire with no `auth` block.
 * Detection is by the presence of `brevo_function` in the config AND on the
 * server record — both paths use the same positive marker.
 */
import { messages } from '../../lang/en';
import type { AppTypeModule } from '../contract';

/** Config-level detection: the `brevo_function` key is present and truthy. */
export function isFunctionAppConfig(
  config: { brevo_function?: unknown } | null | undefined,
): boolean {
  if (!config || typeof config !== 'object') return false;
  return 'brevo_function' in config && !!config.brevo_function;
}

/** Record-level detection: the `brevo_function` key is present and truthy. */
export function isFunctionAppRecord(app: { brevo_function?: unknown } | null | undefined): boolean {
  if (!app || typeof app !== 'object') return false;
  return 'brevo_function' in app && !!app.brevo_function;
}

export const functionAppType: AppTypeModule = {
  id: 'function',
  label: messages.APP_TYPE_FUNCTION,
  availability: 'ga',

  detectConfig: (config) => isFunctionAppConfig(config as { brevo_function?: unknown }),
  detectRecord: (app) => isFunctionAppRecord(app as { brevo_function?: unknown }),

  // A Function app has no config block to recover — `brevo_function: {}` is
  // a static discriminator, not authored content. Always recoverable.
  recoverableFromRecord: (app) => !!app,

  // Nothing type-specific to validate locally. Function apps have no redirect
  // URLs or scopes to check.
  validateConfig: () => {},

  // No wire-only keys — the server does not stamp additional fields onto the
  // `brevo_function` block.
  wireOnlyKeys: [],
};
