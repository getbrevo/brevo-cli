/**
 * What every app type must describe about itself.
 *
 * The CLI has two app types today — an OAuth integration and a UI app (BEX-290) — and the
 * difference between them was, until this module, expressed as `isUiAppConfig(config)`
 * checks scattered across `upload.ts`, `scaffold.ts`, `list.ts`, `create.ts` and
 * `credentials.ts`. The discriminator was already centralised; its *consequences* were not,
 * so adding a third type meant finding every branch by hand.
 *
 * A type now describes itself once and the commands ask it questions. Deliberately NOT in
 * here, and worth knowing before extending it:
 *
 *   - **Request payload building.** `create` and `upload` still build their own bodies. The
 *     exact wire shape is asserted by a lot of tests and confirmed against the platform, so
 *     moving it is a separate, riskier increment than moving the checks.
 *   - **Interactive authoring.** A type's prompts live beside it (`ui/authoring.ts`) but are
 *     imported directly by `app create` rather than hung off the descriptor. Keeping them off
 *     it means `brevo app list` doesn't drag `inquirer` and the whole prompt flow into memory
 *     just to label a row.
 *   - **Rendering.** Each command keeps its own labels and column widths — they genuinely
 *     differ (`Extension:` in the list, `Extension type:` in the upload diff), and unifying
 *     them would change output that tests and users read. What IS shared is the formatting of
 *     repeated sub-entities; see `ui/fields.ts`.
 */
import type { AppConfigLike, AppRecordLike } from './ui/detect';
import type { UiApp } from '../types';

export type { AppConfigLike, AppRecordLike };

/**
 * The config fields `validateConfig` may read.
 *
 * Structural rather than the full `ProjectConfig`, so this module keeps its
 * runtime-dependency-free shape (see `ui/detect.ts` for why that matters) — a value import of
 * `lib/config` here would put the registry behind a module half the test suites mock.
 */
export interface ValidatableConfig {
  appId: string;
  appName: string;
  distribution_type: 'private' | 'public';
  auth: { scopes?: string[]; redirectUris?: string[] };
  ui_app?: UiApp;
}

/**
 * Add a type here and the compiler will point at every exhaustive branch that has to
 * account for it — which is the main reason the registry is a static object literal
 * rather than something plugin-loaded.
 */
export type AppTypeId = 'oauth' | 'ui';

export interface AppTypeModule {
  id: AppTypeId;

  /**
   * Human label — `app list`'s `Type:` row and the `app create` app-type prompt.
   * Sourced from `src/lang/en.ts`, never a literal, so it stays translatable.
   */
  label: string;

  /**
   * `preview` = shipped in the CLI but not live on the Brevo platform; `ga` = live.
   * Both types are `'ga'` today (UI apps since BEX-290).
   *
   * Not the pre-GA build gate, which was a different mechanism and is gone (BEX-405):
   * this describes the *platform*, not the artifact. It is METADATA ONLY and must stay
   * that way — the CLI deliberately has no runtime guard on app types, and `CLAUDE.md`
   * forbids reintroducing one or an internal-account escape hatch. The field exists so
   * docs and a future type can state their stage in one place instead of five
   * hand-maintained notices.
   */
  availability: 'ga' | 'preview';

  /** Is this local `app-config.json` describing this type? */
  detectConfig(config: AppConfigLike | null | undefined): boolean;

  /** Is this *server* record this type? Not always the same signal — see the ui module. */
  detectRecord(app: AppRecordLike | null | undefined): boolean;

  /**
   * Can a complete `app-config.json` be rebuilt from this server record alone?
   *
   * Asked by `brevo app scaffold`'s no-config branch, which materializes a project folder
   * for an app that already exists on the server, before it writes anything.
   *
   * The answer is type-dependent and the difference is invisible from the command's side.
   * An OAuth app's configuration IS the app record — callbacks and scopes come back on the
   * read — so it is always recoverable. A UI app's configuration is its `ui_app` block; the
   * server writes it at create time, but the CLI's own classifier can label a *blockless*
   * record `ui` (it calls anything with no OAuth material a UI app), and such a record
   * arrives with nothing to write. See the ui module's note for the full story.
   *
   * A type that answers false must be refused loudly. It cannot be papered over with a
   * partial write: `ui_app`'s presence is the app-type discriminator, so a config missing
   * the block does not read as an incomplete UI app — it reads as a valid OAuth one, and
   * the next `app upload` pushes an `auth` block where `ui_app` belonged.
   *
   * Lives on the descriptor rather than as an `!app.ui_app` check in the command for the
   * reason the whole registry exists: a third type gets asked the same question instead of
   * needing someone to find this branch by hand.
   */
  recoverableFromRecord(app: AppRecordLike | null | undefined): boolean;

  /**
   * Local pre-flight on the config's shape, before any request. Throws `CliError`.
   * A no-op for a type with nothing local to check.
   *
   * Only ever statements about the FILE. Anything needing the platform to answer (is this
   * slot registered, is this context field allowed) stays server-side on purpose.
   */
  validateConfig(config: ValidatableConfig): void;

  /**
   * Keys the server derives, defaults or stamps, which therefore exist on its side of a
   * comparison only. The upload diff normalizes them away and the write-back strips them.
   *
   * One list per type, read in exactly one place (`stripInjectedKeys`). Splitting this rule
   * across the diff and the write-back is what produced two separate bugs on this branch.
   */
  wireOnlyKeys: readonly string[];
}
