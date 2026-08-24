import { Command, Help } from 'commander';
import { BREVO_CLI_REFERENCE_URL } from './constants';
import { isFeatureAvailable } from './preview';
import type { PreviewFeature } from './preview';

/**
 * A block of help lines that only renders when its feature has shipped.
 *
 * The gated sections here line up 1:1 with the `requires` values in
 * `commands/definitions.ts`, which is what makes `FEATURE_STAGE` the single source
 * of truth for both the help screen and the runtime refusal (BEX-405). Keeping the
 * capability name on the section rather than hardcoding a boolean is the whole
 * point: flipping the table at GA restores these sections with no edit here.
 */
function gatedSection(feature: PreviewFeature, lines: string[]): string[] {
  return isFeatureAvailable(feature) ? lines : [];
}

/** Accepted values of `--distribution`, narrowed while public distribution is pre-GA. */
export function distributionValues(): string {
  return isFeatureAvailable('public-distribution') ? 'private|public' : 'private';
}

/** `app create`'s one-line description — mentions UI apps only when they're offered. */
export function createDescription(): string {
  return isFeatureAvailable('ui-app-type')
    ? 'Create a new app (OAuth, or a UI app via the prompts)'
    : 'Create a new OAuth app';
}

/**
 * The root `brevo --help` screen.
 *
 * Hand-aligned rather than generated: it groups commands by what they're for
 * (app / deployment / review / skill / scope) and shows each one's flags inline,
 * which Commander's default two-column layout can't express. The grouping
 * mirrors the capability gates in `commands/definitions.ts` — see
 * `command-capabilities.test.ts`, which is the executable copy of that rule.
 *
 * Because it is hand-aligned, the pre-GA sections have to be filtered here too —
 * Commander's `hidden` flag governs its own generated output (`brevo app --help`)
 * and cannot reach this string. Both read `isFeatureAvailable`, so there is one
 * decision and two renderers, not two decisions.
 */
function formatRootHelp(description: string): string {
  return [
    `Usage: brevo [options] [command]`,
    ``,
    description,
    ``,
    `Options:`,
    `  -V, --version    output the version number`,
    `  -h, --help       display help for command`,
    ``,
    `Commands:`,
    `  brevo login                 [--browser] [--json]      Authenticate with your Brevo account`,
    `  brevo logout                [--json]                  Clear stored credentials`,
    `  brevo whoami                [--json]                  Show current authenticated user`,
    ``,
    `App commands:`,
    `  brevo app init                                        Quick setup — login, create app, and scaffold`,
    // `--distribution` itself is GA — only the `public` VALUE is gated, so the flag
    // stays and its value list narrows. Same for the app-type prompt: a locked run
    // is OAuth-only, so the description stops advertising a choice it won't offer.
    `  brevo app create            [--name] [--distribution ${distributionValues()}]`,
    `                              [--redirect-uri <url>...] [--logo-uri <url>] [--json]`,
    `                                                        ${createDescription()}`,
    `  brevo app list              [--json]                  List all apps in your account`,
    `  brevo app credentials       [--app-id <id>] [--reveal-secret] [--json]`,
    `                                                        Show an app's client ID and secret`,
    `  brevo app scaffold          [--app-id <id>] [--json]  Add a feature (e.g. OAuth server) here`,
    `  brevo app start             [feature] [--port <port>] Run a scaffolded feature locally`,
    `  brevo app upload            [--yes] [--json]          Push app-config.json to Brevo`,
    `  brevo app delete            [--app-id <id>] [--force] [--json]`,
    `                                                        Delete an app`,
    ``,
    // ELIMINATION SITE — `__BREVO_PREVIEW__` wraps the call rather than living inside a
    // helper, because an array passed as a function *argument* is still evaluated: a
    // `previewOnlySection(feature, [...])` helper left every one of these lines in the
    // published bundle as a readable string. Folding `false ? … : []` at the call site is
    // what removes the array itself.
    //
    // **The build flag is therefore the outer authority for help text, above
    // `FEATURE_STAGE`.** At GA that is a trap — flipping a row to `'ga'` is not enough,
    // since a published build still has `__BREVO_PREVIEW__ === false` and would keep
    // hiding the restored section. The wrapper must be removed by hand at the same time;
    // `RELEASE-CHECKLIST.md` lists it, alongside the identical trap in
    // `commands/preview-definitions.ts`.
    ...(__BREVO_PREVIEW__
      ? gatedSection('account-install', [
          `App-deployment commands (UI apps only):`,
          `  brevo app deploy            [account-id] [--app-id <id>] [--force] [--json]`,
          `                                                        Make an app available in an account`,
          `  brevo app rollback          [account-id] [--app-id <id>] [--force] [--json]`,
          `                                                        Roll back an app from an account`,
          ``,
        ])
      : []),
    ...(__BREVO_PREVIEW__
      ? gatedSection('review-lifecycle', [
          `App-review commands (public apps only):`,
          `  brevo app submit            [--app-id <id>] [--json]  Submit a public app for review`,
          `  brevo app status            [--app-id <id>] [--json]  Show an app's review status`,
          // `brevo app withdraw` is deliberately absent. It is registered and callable in
          // a preview build, just marked `hidden` in `commands/preview-definitions.ts` so
          // it is advertised on neither help screen. Commander's `hidden` governs its own
          // generated output and cannot reach this hand-written string, so the omission
          // has to be made here by hand — the same two-renderers/one-decision split the
          // comment above describes for the gate. Restore both together.
          ``,
        ])
      : []),
    `Skill commands:`,
    `  brevo skill:cli install     [--json]                  Install the brevo-cli Claude Code skill`,
    `  brevo skill:cli uninstall   [--json]                  Remove the brevo-cli skill`,
    ``,
    ...(__BREVO_PREVIEW__
      ? gatedSection('brevo-function-type', [
          `Function commands (alias: brevo fn):`,
          `  brevo function list              [--draft] [--json]   List all Brevo Functions in your account`,
          `  brevo function get               [--id <id>] [--json] Show details of a Brevo Function`,
          `  brevo function activate          [--id <id>] [--json] Activate a Brevo Function`,
          `  brevo function deactivate        [--id <id>] [--json] Deactivate a Brevo Function`,
          `  brevo function delete            [--id <id>] [--force] [--json]`,
          `                                                        Delete a Brevo Function`,
          `  brevo function init                                   Create a new Brevo Function (interactive)`,
          ``,
        ])
      : []),
    `Scope commands:`,
    `  brevo app available-scopes  [--web] [--json]          List OAuth scopes supported by the IdP`,
    `                                                        (--web opens the catalog in a browser)`,
    ``,
    `Run \`brevo <command> --help\` for details on a specific command.`,
    ``,
    `Examples:`,
    `  $ brevo login                                   # authenticate interactively`,
    `  $ brevo app init                                # guided setup`,
    `  $ brevo app create --name "My App" --json       # create app, JSON output`,
    `  $ brevo app list --json                         # list apps as JSON`,
    `  $ brevo app scaffold --app-id APPID             # generate starter code`,
    `  $ brevo app start oauth --port 3000             # start OAuth test server`,
    `  $ brevo app available-scopes --web              # browse OAuth scope catalog`,
    ``,
    `Docs: ${BREVO_CLI_REFERENCE_URL}`,
    ``,
  ].join('\n');
}

/**
 * Build the `formatHelp` callback for the root program.
 *
 * Commander copies help configuration down to every subcommand
 * (`copyInheritedSettings`), so a single `formatHelp` also runs for
 * `brevo app create --help`. Returning the root screen there would repeat the
 * whole command list and hide the subcommand's own flags — the opposite of what
 * "Run `brevo <command> --help` for details" promises. So only the root gets
 * the hand-aligned screen; everything else falls through to Commander's default
 * formatter, which builds its output from the command's own options and
 * arguments.
 */
export function createHelpFormatter(root: Command): (cmd: Command, helper: Help) => string {
  return (cmd, helper) => {
    if (cmd !== root) {
      return Help.prototype.formatHelp.call(helper, cmd, helper);
    }
    return formatRootHelp(helper.commandDescription(cmd));
  };
}
