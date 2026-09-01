/**
 * Command definitions for features that have not shipped (BEX-405).
 *
 * These live in their own module for a build reason, not an organisational one.
 * `definitions.ts` references this array behind `__BREVO_PREVIEW__`, which esbuild folds
 * to `false` in a published build; the array then becomes unreachable and the bundler
 * drops it *along with the three handler modules only it imports*. Inline in
 * `definitions.ts` the imports would be live references and every gated command would
 * ship, unreachable but present — which is the thing the build-time gate exists to
 * avoid. `scripts/build.mjs` asserts on the output that they really are gone.
 *
 * `app install` / `app uninstall` used to live here too; they moved to
 * `definitions.ts` when UI apps went GA.
 *
 * So: do not import anything from here anywhere else, and do not move these entries
 * back into `definitions.ts` "now that they're gated" — the gate is what this
 * separation implements.
 *
 * At GA, move the released entries back into `definitions.ts` and delete this file
 * when it empties. See `RELEASE-CHECKLIST.md`.
 */
import type { CommandDefinition } from '../lib/command-registry';
import { EXAMPLE_APP_ID } from '../lib/constants';
import { parseAppId } from '../lib/validators';

import { statusCommand } from './app/status';
import { submitCommand } from './app/submit';
import { withdrawCommand } from './app/withdraw';

/** The `brevo app <name>` subcommands gated behind an unreleased feature. */
export const previewAppCommands: CommandDefinition[] = [
  {
    name: 'status',
    requires: 'review-lifecycle',
    description: "Show an app's review status",
    examples: [
      'brevo app status',
      `brevo app status --app-id ${EXAMPLE_APP_ID}`,
      `brevo app status --app-id ${EXAMPLE_APP_ID} --json`,
    ],
    options: [
      {
        flags: '--app-id <id>',
        description: 'App ID (uses app-config.json if omitted)',
        parser: (v) => parseAppId(v),
      },
      { flags: '--json', description: 'Output as JSON' },
    ],
    handler: (opts) =>
      statusCommand({ appId: opts.appId as string | undefined, json: Boolean(opts.json) }),
  },
  {
    name: 'withdraw',
    requires: 'review-lifecycle',
    // Unlisted even in a preview build, unlike its four siblings here. The command works
    // — QA suite 7 and the public-app smoke script both drive it, and `app upload`'s
    // under-review refusal still points at it by name — it is simply not advertised on
    // either help screen while the review lifecycle is being finished.
    //
    // This is the *second* renderer, not the only one: `lib/help.ts`'s hand-aligned root
    // screen is a plain string that Commander's `hidden` cannot filter, so the matching
    // `brevo app withdraw` lines were removed from its `review-lifecycle` section too.
    // Un-hiding means editing both. See `RELEASE-CHECKLIST.md` → *Before public-apps GA*.
    hidden: true,
    description: 'Withdraw an app from submission',
    examples: [
      `brevo app withdraw --app-id ${EXAMPLE_APP_ID}`,
      `brevo app withdraw --app-id ${EXAMPLE_APP_ID} --force`,
      `brevo app withdraw --app-id ${EXAMPLE_APP_ID} --json`,
    ],
    options: [
      {
        flags: '--app-id <id>',
        description: 'App ID',
        parser: (v) => parseAppId(v),
      },
      { flags: '--force', description: 'Skip confirmation (for CI)' },
      { flags: '--json', description: 'Output as JSON' },
    ],
    handler: (opts) =>
      withdrawCommand({
        appId: opts.appId as string | undefined,
        force: Boolean(opts.force),
        json: Boolean(opts.json),
      }),
  },
  {
    name: 'submit',
    requires: 'review-lifecycle',
    description: 'Submit a public app for review',
    examples: [
      'brevo app submit',
      `brevo app submit --app-id ${EXAMPLE_APP_ID}`,
      `brevo app submit --app-id ${EXAMPLE_APP_ID} --json`,
    ],
    options: [
      {
        flags: '--app-id <id>',
        description: 'App ID (uses app-config.json if omitted)',
        parser: (v) => parseAppId(v),
      },
      {
        flags: '--json',
        description: 'Print the submission form URL as JSON instead of opening a browser',
      },
    ],
    handler: (opts) =>
      submitCommand({
        appId: opts.appId as string | undefined,
        json: Boolean(opts.json),
      }),
  },
];
