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
import type { CommandDefinition } from '../lib/command-registry';
import { parseAppId } from '../lib/validators';

import { deployCommand } from './app/deploy';
import { rollbackCommand } from './app/rollback';
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
