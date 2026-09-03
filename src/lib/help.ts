import { Command, Help } from 'commander';
import { BREVO_CLI_REFERENCE_URL } from './constants';

/**
 * The root `brevo --help` screen.
 *
 * Hand-aligned rather than generated: it groups commands by what they're for
 * (app / install / review / skill / scope) and shows each one's flags inline,
 * which Commander's default two-column layout can't express. The grouping
 * mirrors the capability declarations in `commands/definitions.ts` — see
 * `command-capabilities.test.ts`, which is the executable copy of that rule.
 *
 * **This screen is a second renderer, and nothing propagates into it.** Commander's
 * `hidden` flag governs only its own generated output (`brevo app --help`) and cannot
 * reach this string, so a command added, removed or hidden in `definitions.ts` has to be
 * added, removed or hidden here by hand in the same change. `help-surface.test.ts`
 * asserts the two agree, and exists because they have silently disagreed before.
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
    `  brevo app create            [--name] [--distribution private|public]`,
    `                              [--redirect-uri <url>...] [--logo-uri <url>] [--json]`,
    `                                                        Create a new app (OAuth, or a UI app via the prompts)`,
    `  brevo app list              [--json]                  List all apps in your account`,
    `  brevo app credentials       [--app-id <id>] [--reveal-secret] [--json]`,
    `                                                        Show an app's client ID and secret`,
    `  brevo app scaffold          [--app-id <id>] [--json]  Add a feature (e.g. OAuth server) here`,
    `  brevo app start             [feature] [--port <port>] Run a scaffolded feature locally`,
    `  brevo app upload            [--yes] [--json]          Push app-config.json to Brevo`,
    `  brevo app delete            [--app-id <id>] [--force] [--json]`,
    `                                                        Delete an app`,
    ``,
    // Groups the two commands whose `requires` is 'account-install' (UI apps only).
    // The heading is the prose copy of that rule; `command-capabilities.test.ts` holds
    // the executable one.
    `App-install commands (UI apps only):`,
    `  brevo app install           [account-id] [--app-id <id>] [--force] [--json]`,
    `                                                        Install an app into an account`,
    `  brevo app uninstall         [account-id] [--app-id <id>] [--force] [--json]`,
    `                                                        Uninstall an app from an account`,
    ``,
    // The three commands whose `requires` is 'review-lifecycle' (public apps only).
    //
    // `brevo app withdraw` is the worked example of the two-renderer warning above: it
    // was marked `hidden` while the review lifecycle was being finished, which suppressed
    // its Commander help entry and did nothing at all to this string — so its two lines
    // had to be removed here by hand, and restored the same way when it was un-hidden.
    // Never assume `hidden` covers this screen.
    `App-review commands (public apps only):`,
    `  brevo app submit            [--app-id <id>] [--json]  Submit a public app for review`,
    `  brevo app status            [--app-id <id>] [--json]  Show an app's review status`,
    `  brevo app withdraw          [--app-id <id>] [--force] [--json]`,
    `                                                        Withdraw an app from submission`,
    ``,
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
