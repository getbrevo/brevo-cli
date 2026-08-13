/**
 * The app-type registry.
 *
 * A static object literal, deliberately — not a plugin loader and not dynamic registration.
 * Two types (three, soon) is not a plugin problem, and a static map is what lets the compiler
 * keep checking exhaustiveness over `AppTypeId`. That checking is doing real work: it is what
 * surfaced the second unguarded null dereference when `redirect_uris` was typed as nullable.
 *
 * Order matters in `resolveFromConfig` / `resolveFromRecord`: both fall through to `oauth`,
 * because OAuth is detected by elimination (no `ui_app` block) and would otherwise match
 * everything.
 */
import type { ProjectConfig } from '../lib/config';
import type { AppRecordLike, AppTypeId, AppTypeModule } from './contract';
import { oauthAppType } from './oauth';
import { uiAppType } from './ui';

export type { AppTypeId, AppTypeModule, AppRecordLike } from './contract';
export {
  assertCapability,
  capabilitiesFor,
  supports,
  type Capability,
  type Distribution,
} from './capabilities';

export const APP_TYPES: Readonly<Record<AppTypeId, AppTypeModule>> = {
  oauth: oauthAppType,
  ui: uiAppType,
};

/**
 * Every type except the fallback, in detection order. `oauth` is excluded because its
 * predicate is the negation of the others' and matches anything that reaches it.
 */
const POSITIVELY_DETECTED: readonly AppTypeModule[] = [uiAppType];

/** Which type does this local `app-config.json` describe? Never null — OAuth is the default. */
export function resolveFromConfig(
  config: Pick<ProjectConfig, 'ui_app'> | null | undefined,
): AppTypeModule {
  return POSITIVELY_DETECTED.find((type) => type.detectConfig(config)) ?? oauthAppType;
}

/**
 * Which type is this *server* record?
 *
 * Weaker than the config path and knowingly so: the list endpoint echoes no `ui_app` block
 * today, so the UI module falls back to the absence of every piece of OAuth material. See
 * `isUiAppRecord` for why that requires BOTH an empty client_id and no callbacks.
 */
export function resolveFromRecord(app: AppRecordLike | null | undefined): AppTypeModule {
  return POSITIVELY_DETECTED.find((type) => type.detectRecord(app)) ?? oauthAppType;
}

export function appTypeById(id: AppTypeId): AppTypeModule {
  return APP_TYPES[id];
}
