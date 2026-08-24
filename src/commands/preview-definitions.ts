/**
 * Command definitions for features that have not shipped (BEX-405).
 *
 * These live in their own module for a build reason, not an organisational one.
 * `definitions.ts` references this array behind `__BREVO_PREVIEW__`, which esbuild folds
 * to `false` in a published build; the array then becomes unreachable and the bundler
 * drops it *along with the five handler modules only it imports*. Inline in
 * `definitions.ts` the imports would be live references and every gated command would
 * ship, unreachable but present — which is the thing the build-time gate exists to
 * avoid. `scripts/build.mjs` asserts on the output that they really are gone.
 *
 * So: do not import anything from here anywhere else, and do not move these entries
 * back into `definitions.ts` "now that they're gated" — the gate is what this
 * separation implements.
 *
 * At GA, move the released entries back into `definitions.ts` and delete this file
 * when it empties. See `RELEASE-CHECKLIST.md`.
 */
import type { CommandDefinition, SubcommandGroupDefinition } from '../lib/command-registry';
import { parseAppId } from '../lib/validators';

import { deployCommand } from './app/deploy';
import { rollbackCommand } from './app/rollback';
import { statusCommand } from './app/status';
import { submitCommand } from './app/submit';
import { withdrawCommand } from './app/withdraw';
import { listFunctionCommand } from './function/list';
import { getFunctionCommand } from './function/get';
import { activateFunctionCommand } from './function/activate';
import { deactivateFunctionCommand } from './function/deactivate';
import { deleteFunctionCommand } from './function/delete';
import { initFunctionCommand } from './function/init';

/** The `brevo app <name>` subcommands gated behind an unreleased feature. */
export const previewAppCommands: CommandDefinition[] = [
  {
    name: 'status',
    requires: 'review-lifecycle',
    description: "Show an app's review status",
    examples: [
      'brevo app status',
      'brevo app status --app-id 42',
      'brevo app status --app-id 42 --json',
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
    name: 'deploy',
    requires: 'account-install',
    description: 'Make an app available in a Brevo account',
    arguments: [
      {
        name: '[account-id]',
        description: 'Brevo account (tenant) ID (defaults to your own account)',
      },
    ],
    examples: [
      'brevo app deploy',
      'brevo app deploy 99999',
      'brevo app deploy 99999 --app-id 42',
      'brevo app deploy 99999 --force --json',
    ],
    options: [
      {
        flags: '--app-id <id>',
        description: 'App ID (uses app-config.json if omitted)',
        parser: (v) => parseAppId(v),
      },
      { flags: '--force', description: 'Skip confirmation (for CI)' },
      { flags: '--json', description: 'Output as JSON' },
    ],
    handler: (opts, accountId) =>
      deployCommand({
        accountId: accountId as string | undefined,
        appId: opts.appId as string | undefined,
        force: Boolean(opts.force),
        json: Boolean(opts.json),
      }),
  },
  {
    name: 'rollback',
    requires: 'account-install',
    description: 'Roll back an app from a Brevo account',
    arguments: [
      {
        name: '[account-id]',
        description: 'Brevo account (tenant) ID (defaults to your own account)',
      },
    ],
    examples: [
      'brevo app rollback',
      'brevo app rollback 99999',
      'brevo app rollback 99999 --app-id 42',
      'brevo app rollback 99999 --force --json',
    ],
    options: [
      {
        flags: '--app-id <id>',
        description: 'App ID (uses app-config.json if omitted)',
        parser: (v) => parseAppId(v),
      },
      { flags: '--force', description: 'Skip confirmation (for CI)' },
      { flags: '--json', description: 'Output as JSON' },
    ],
    handler: (opts, accountId) =>
      rollbackCommand({
        accountId: accountId as string | undefined,
        appId: opts.appId as string | undefined,
        force: Boolean(opts.force),
        json: Boolean(opts.json),
      }),
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
      'brevo app withdraw --app-id 42',
      'brevo app withdraw --app-id 42 --force',
      'brevo app withdraw --app-id 42 --json',
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
      'brevo app submit --app-id 42',
      'brevo app submit --app-id 42 --json',
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

/** The `brevo function` group, gated behind the preview build. */
export const previewFunctionGroup: SubcommandGroupDefinition = {
  name: 'function',
  aliases: ['fn'],
  description: 'Manage Brevo Functions',
  commands: [
    {
      name: 'list',
      description: 'List all Brevo Functions in your account',
      examples: [
        'brevo function list',
        'brevo function list --draft',
        'brevo function list --json',
      ],
      options: [
        { flags: '--draft', description: 'List only draft functions' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        listFunctionCommand({ json: Boolean(opts.json), draft: Boolean(opts.draft) }),
    },
    {
      name: 'get',
      description: 'Show details of a Brevo Function',
      examples: [
        'brevo function get',
        'brevo function get --id fn-001',
        'brevo function get --id fn-001 --json',
      ],
      options: [
        { flags: '--id [id]', description: 'Function ID (shows a picker if omitted)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        getFunctionCommand({ id: opts.id as string | undefined, json: Boolean(opts.json) }),
    },
    {
      name: 'activate',
      description: 'Activate a Brevo Function',
      examples: [
        'brevo function activate',
        'brevo function activate --id fn-001',
        'brevo function activate --id fn-001 --json',
      ],
      options: [
        { flags: '--id [id]', description: 'Function ID (shows a picker if omitted)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        activateFunctionCommand({ id: opts.id as string | undefined, json: Boolean(opts.json) }),
    },
    {
      name: 'deactivate',
      description: 'Deactivate a Brevo Function',
      examples: [
        'brevo function deactivate',
        'brevo function deactivate --id fn-001',
        'brevo function deactivate --id fn-001 --json',
      ],
      options: [
        { flags: '--id [id]', description: 'Function ID (shows a picker if omitted)' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        deactivateFunctionCommand({
          id: opts.id as string | undefined,
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'delete',
      description: 'Delete a deployed Brevo Function',
      examples: [
        'brevo function delete',
        'brevo function delete --id fn-001',
        'brevo function delete --id fn-001 --force',
        'brevo function delete --id fn-001 --json',
      ],
      options: [
        { flags: '--id [id]', description: 'Function ID (shows a picker if omitted)' },
        { flags: '--force', description: 'Skip confirmation' },
        { flags: '--json', description: 'Output as JSON' },
      ],
      handler: (opts) =>
        deleteFunctionCommand({
          id: opts.id as string | undefined,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        }),
    },
    {
      name: 'init',
      description: 'Create a new Brevo Function',
      examples: ['brevo function init', 'brevo fn init'],
      options: [{ flags: '--json', description: 'Output as JSON' }],
      handler: (opts) => initFunctionCommand({ json: Boolean(opts.json) }),
    },
  ],
};
