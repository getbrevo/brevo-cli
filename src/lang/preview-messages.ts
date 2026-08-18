import { CLI } from '../lib/constants';

/**
 * User-facing strings for features that have not shipped (BEX-405).
 *
 * Split out of `en.ts` for a build reason, not a tidiness one. `messages` is a single
 * object literal, and esbuild cannot prune properties from one — so with these inline,
 * every string for `app install`, `app uninstall`, `app submit`, `app status`,
 * `app withdraw` and UI-app authoring shipped in the published bundle even though no
 * surviving code referenced them: `strings` on the binary read back the whole
 * unreleased feature set. As a separate module spread in behind `__BREVO_PREVIEW__`,
 * the object becomes unreachable and the bundler drops it.
 *
 * `en.ts` types the spread as `typeof previewMessages` even when it is empty, so every
 * call site stays type-safe. That is a deliberate lie about the runtime shape, and a
 * safe one: the only code reading these keys lives in the modules eliminated alongside
 * them, so nothing can observe the absence.
 *
 * At GA, move the released strings back into `en.ts` and delete this file when it
 * empties. See `RELEASE-CHECKLIST.md`.
 */
export const previewMessages = {
  // App create — UI app (BEX-290)
  // Placement choices are read from the platform's extension-point registry at prompt
  // time (BEX-361) — fetch-only, no local fallback, so a partner can never author a slot
  // the platform doesn't have. Two loads: the record pages, then the placements on the
  // pages that were picked.
  APP_CREATE_UI_PAGES_SPINNER: 'Loading record pages...',
  APP_CREATE_UI_POINTS_SPINNER: 'Loading placements...',
  APP_CREATE_UI_POINTS_FETCH_FAILED:
    'Could not load the available placements from the Brevo API — the UI-app flow needs them to offer where your app can appear. Check your connection and try again. Creating an OAuth app does not need this and still works.',
  APP_CREATE_UI_POINTS_EMPTY:
    'The Brevo API returned no available placements for UI apps. This usually means the extension-point registry has not been seeded in this environment — try again later.',
  // Raised when the registry has rows, but none of them can serve the chosen extension
  // type. Distinct from the empty case: the fix is a different integration type, not
  // waiting for a seed.
  APP_CREATE_UI_POINTS_NONE_FOR_TYPE: (extensionType: string) =>
    `None of the available placements can host a "${extensionType}" extension. This environment's extension-point registry may predate it — try again later.`,
  // Single-select (BEX-426): the interactive flow authors exactly one placement, because
  // the CTA fields (label, more_info, destination) live per placement now and asking them
  // per page would multiply the prompt count. More placements are added by hand as further
  // `surface_point_list` entries in app-config.json — the box hint says so.
  APP_CREATE_UI_SURFACE_PROMPT: 'Which record page should it appear on?',
  // The placement prompt on the picked page: an app takes exactly one spot on a page.
  // Replaces the old kind-then-place pair (kind is a property of the slot, not a question
  // — a partner picking "Header menu" has already said they want a menu entry) and the
  // grouped multi-select that briefly followed it.
  APP_CREATE_UI_PLACEMENT_PAGE_PROMPT: (page: string) =>
    `Where should it appear on the ${page} page?`,
  // Integration type — asked SECOND, before any placement, because it is the decision a
  // partner arrives with. Only Link is selectable; Iframe is shown disabled so the
  // roadmap is visible where the choice is being made rather than hidden.
  APP_CREATE_UI_INTEGRATION_PROMPT: 'Do you want to add a link or an iframe?',
  APP_CREATE_UI_INTEGRATION_EXTERNAL_LINK: 'Link            (Opens your URL in a new tab)',
  APP_CREATE_UI_INTEGRATION_MODAL_IFRAME: 'Iframe          (Embeds your page in a modal)',
  APP_CREATE_UI_INTEGRATION_COMING_SOON: 'coming soon',
  // Each field says what it renders as, so a partner filling the form knows what
  // they are writing. Both fields render in two places, and the prompt names both:
  // `label` is the menu entry's text AND a card's CTA button, `more_info` is the
  // menu entry's second line AND a card's description.
  APP_CREATE_UI_LABEL_PROMPT: 'Label — the menu entry text, and the button text on a card:',
  APP_CREATE_UI_MORE_INFO_PROMPT:
    'More info — supporting text under the menu entry, and a card’s description (optional):',
  APP_CREATE_UI_REDIRECT_LINK_PROMPT:
    'Redirect link — the destination URL your app opens (record context arrives as query parameters):',
  APP_CREATE_UI_BOX_TITLE: 'UI app created',
  // `label` labels the menu entry (BEX-290). The one piece of rendered text that has
  // no field is a CARD's title, which is the app name — worth saying, since it is now
  // the only place a partner might hunt for a field that doesn't exist.
  APP_CREATE_UI_BOX_LABEL_NOTE: (label: string, appName: string) =>
    `The menu entry is labelled "${label}". On a card that text becomes the button, and the card's title is the app name ("${appName}").`,
  // Record context reaches the partner's endpoint as query parameters only — there is
  // no path templating — so the summary prints the exact URL shape to build against.
  APP_CREATE_UI_BOX_EXAMPLE_URL_LABEL: 'Brevo will open, for example:',
  APP_CREATE_UI_BOX_EXAMPLE_URL_NOTE:
    'Values are placeholders. Read them as query parameters — the path is never templated.',
  // Also the pointer to MORE placements: the flow authors one, and each further one is a
  // hand-written `surface_point_list` entry carrying its own label and destination.
  APP_CREATE_UI_BOX_HINT: `Edit the \`ui_app\` block in app-config.json to change any of this — add more placements as extra \`surface_point_list\` entries, each with its own label and redirect link — then run \`${CLI.APP_UPLOAD}\`.`,

  // App install / uninstall — per-account availability for UI apps (BEX-290)
  APP_INSTALL_SELECT: 'Select an app to install:',
  APP_INSTALL_CONFIRM: (name: string, appId: string, accountId: string) =>
    `Install app "${name}" (${appId}) into account ${accountId}?`,
  APP_INSTALL_CANCELLED: 'Install cancelled.',
  APP_INSTALL_SUCCESS: (appId: string, accountId: string) =>
    `App ${appId} installed into account ${accountId}.`,
  // Sub-account resolution, shared by install and uninstall. Only a master (corporate)
  // account ever reaches these: a plain account resolves to itself with no prompt.
  APP_INSTALL_SELECT_ACCOUNT: 'Select the account to install into:',
  APP_INSTALL_ACCOUNT_ID_REQUIRED: `This is a corporate account, so the target account can't be resolved automatically.\n\n  Pass it explicitly: ${CLI.APP_INSTALL('<account-id>')}\n  (Choosing one from a list requires an interactive terminal.)`,
  APP_INSTALL_NO_SUB_ACCOUNTS: `No active sub-accounts found on this corporate account.\n\n  Pass the target account explicitly: ${CLI.APP_INSTALL('<account-id>')}`,
  // The spec's installation flow requires install to refuse until the config has
  // been validated by an upload. `version` is only ever written by a successful
  // upload, so its absence is a reliable local signal.
  APP_INSTALL_NOT_UPLOADED: `Please first validate your configuration with \`${CLI.APP_UPLOAD}\`.`,
  APP_UNINSTALL_SELECT: 'Select an app to uninstall:',
  APP_UNINSTALL_CONFIRM: (name: string, appId: string, accountId: string) =>
    `Uninstall app "${name}" (${appId}) from account ${accountId}?`,
  APP_UNINSTALL_CANCELLED: 'Uninstall cancelled.',
  APP_UNINSTALL_SUCCESS: (appId: string, accountId: string) =>
    `App ${appId} uninstalled from account ${accountId}.`,
  APP_UNINSTALL_NOT_INSTALLED: (appId: string, accountId: string) =>
    `App ${appId} is not installed in account ${accountId}.`,
  APP_INSTALL_NON_INTERACTIVE:
    'Cannot prompt for confirmation in non-interactive mode. Use --force or --json to skip.',

  // App submit (BEX-221)
  APP_SUBMIT_CHECKING_STATUS: 'Checking app status...',
  APP_SUBMIT_FETCHING: 'Fetching app...',
  APP_SUBMIT_PICK_APP: 'Which app do you want to submit for review?',
  APP_SUBMIT_NO_APP_RESOLVED:
    'Cannot determine which app to submit. Provide --app-id or run from a directory with app-config.json.',
  APP_SUBMIT_NOT_FOUND: (appId: string): string => `App ${appId} not found.`,
  APP_SUBMIT_OUT_OF_SYNC: (fields: string[], appId: string): string =>
    `Configuration mismatch detected — your local app-config.json differs from the app on Brevo (${fields.join(', ')}).\n  Please update your local configuration with the latest server values, or run \`${CLI.APP_UPLOAD}\` to upload your local changes to the server, then re-run \`${CLI.APP_SUBMIT(appId)}\`.`,
  APP_SUBMIT_OUT_OF_SYNC_DIFF: (diff: string, appId: string): string =>
    `Configuration mismatch detected — your local app-config.json differs from the app on Brevo:\n${diff}\n\n  Please update your local configuration with the latest server values, or run \`${CLI.APP_UPLOAD}\` to upload your local changes to the server, then re-run \`${CLI.APP_SUBMIT(appId)}\`.`,
  APP_SUBMIT_IN_SYNC:
    'No configuration mismatch detected. Showing the submission confirmation prompt with the complete app configuration below.',
  APP_SUBMIT_CONFIRM_HEADER: 'You are about to submit this app for review:',
  APP_SUBMIT_CONFIRM_PROMPT: 'Submit this app for review?',
  APP_SUBMIT_CANCELLED: 'Submission cancelled.',
  APP_SUBMIT_FORM_GATE:
    'Note: Your app will be submitted for review only after you complete and submit the Google Form.',
  APP_SUBMIT_BROWSER_OPENED: (url: string, appId: string): string =>
    `We've opened a browser tab with the submission form for app ${appId}:\n  ${url}`,
  APP_SUBMIT_BROWSER_FAILED: (url: string, appId: string): string =>
    `We couldn't open a browser automatically. Open the submission form for app ${appId} yourself:\n  ${url}`,
  APP_SUBMIT_NEXT_STEPS: `Please submit the form for review. You'll receive an email once your app has been reviewed — check its status anytime with \`${CLI.APP_STATUS}\`.`,
  APP_SUBMIT_NO_FORM_URL: `Review submission is currently unavailable. This may happen if your app has not been uploaded yet or if it has already been submitted and is under review. You can check the current status of your app using \`${CLI.APP_STATUS}\`.`,

  // App status
  APP_STATUS_SELECT: 'Select an app:',
  APP_STATUS_TITLE: 'App status',
  // Canned copy per review state (server-side `app_submission_states.state`).
  // Reviewer feedback is delivered by email, not surfaced here (BEX-252).
  APP_STATUS_MESSAGE: (state: string): string => {
    switch (state) {
      // Empty/missing state is normalized to the "unknown" sentinel upstream
      // (src/commands/app/status.ts); '' is kept as a defensive fallthrough.
      case '':
      case 'unknown':
        return `Status information isn't available for your app yet. Make sure your app is public and has been uploaded with \`${CLI.APP_UPLOAD}\`.`;
      case 'configured':
        return "Your app is set up but hasn't been submitted for review yet.";
      case 'submitted':
        return 'Your app has been submitted and is waiting to be reviewed.';
      case 'in_review':
        return 'Your app is currently being reviewed by our team.';
      case 'approved':
        return 'Your app has been approved.';
      case 'rejected':
        return 'Your app was not approved. Check your email for details.';
      case 'changes_requested':
        return 'Changes have been requested for your app. Check your email for details.';
      default:
        return `Your app is in state "${state}".`;
    }
  },

  // App withdraw
  APP_WITHDRAW_SELECT: 'Select an app to withdraw:',
  APP_WITHDRAW_CONFIRM: (name: string, id: string) =>
    `Withdraw app "${name}" (${id}) from submission?`,
  APP_WITHDRAW_CANCELLED: 'Withdrawal cancelled.',
  APP_WITHDRAW_SUCCESS: (id: string) => `App ${id} withdrawn from submission.`,
  APP_WITHDRAW_NOT_SUBMITTED: (id: string) => `App ${id} has not been submitted yet.`,
  APP_WITHDRAW_SUBMIT_HINT: (id: string) => `Submit it first: ${CLI.APP_SUBMIT(id)}`,
  APP_SUBMIT_NOT_PUBLIC: (appId: string): string =>
    `App ${appId} is private. Private apps cannot be submitted for review. Only public apps are eligible for the approval process. Please make your app public before submitting it for review.`,
} as const;
