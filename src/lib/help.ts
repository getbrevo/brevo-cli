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
 * (app / install / review / skill / scope) and shows each one's flags inline,
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
    // GA (UI apps shipped): `account-install` is 'ga' in FEATURE_STAGE, so this renders
    // in every build. What GA removed is the `__BREVO_PREVIEW__` wrapper — the
    // gatedSection call stays, so the section keeps lining up 1:1 with the commands'
    // `requires: 'account-install'`: an emergency flip of the row back to 'preview'
    // hides it here exactly as registerCommand hides the commands, instead of root help
    // advertising what the runtime refuses. The review-lifecycle block below shed its
    // wrapper the same way at public-apps GA; no block carries one now.
    ...gatedSection('account-install', [
      `App-install commands (UI apps only):`,
      `  brevo app install           [account-id] [--app-id <id>] [--force] [--json]`,
      `                                                        Install an app into an account`,
      `  brevo app uninstall         [account-id] [--app-id <id>] [--force] [--json]`,
      `                                                        Uninstall an app from an account`,
      ``,
    ]),
    // GA (public apps shipped): `review-lifecycle` is 'ga' in FEATURE_STAGE, so this
    // section renders in every build. What GA removed is the `__BREVO_PREVIEW__` wrapper
    // that used to fold the whole array away — the build flag was the OUTER authority
    // here, above FEATURE_STAGE, so flipping the row alone would have kept the section
    // hidden in a published build. The `gatedSection` call stays, so this keeps lining up
    // 1:1 with the commands' `requires: 'review-lifecycle'`: an emergency flip of the row
    // back to 'preview' hides it here exactly as registerCommand hides the commands,
    // instead of root help advertising what the runtime refuses.
    //
    // `brevo app withdraw` was additionally marked `hidden` while the review lifecycle was
    // being finished, and Commander's `hidden` governs only its own generated output — it
    // cannot reach this hand-written string, so withdraw's two lines had to be removed
    // here by hand and restored the same way. Two renderers, one decision: keep them in
    // step, and never assume `hidden` covers this screen.
    ...gatedSection('review-lifecycle', [
      `App-review commands (public apps only):`,
      `  brevo app submit            [--app-id <id>] [--json]  Submit a public app for review`,
      `  brevo app status            [--app-id <id>] [--json]  Show an app's review status`,
      `  brevo app withdraw          [--app-id <id>] [--force] [--json]`,
      `                                                        Withdraw an app from submission`,
      ``,
    ]),
    `Skill commands:`,
    `  brevo skill:cli install     [--json]                  Install the brevo-cli Claude Code skill`,
    `  brevo skill:cli uninstall   [--json]                  Remove the brevo-cli skill`,
    ``,
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
