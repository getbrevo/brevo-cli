import { CLI } from '../lib/constants';

/**
 * User-facing strings for features that have not shipped (BEX-405).
 *
 * Split out of `en.ts` for a build reason, not a tidiness one. `messages` is a single
 * object literal, and esbuild cannot prune properties from one — so with these inline,
 * every string for `app submit`, `app status` and `app withdraw` shipped in the
 * published bundle even though no surviving code referenced them: `strings` on the
 * binary read back the whole unreleased feature set. As a separate module spread in
 * behind `__BREVO_PREVIEW__`, the object becomes unreachable and the bundler drops it.
 * (The UI-app authoring and `app install` / `app uninstall` strings lived here too,
 * until UI apps went GA and they moved back into `en.ts`.)
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

  // Function selection (shared picker)
  FUNCTION_SELECT_NON_INTERACTIVE: (command: string) =>
    `Cannot show the function picker in non-interactive mode. Name the function instead:\n\n      ${command}\n\n  \`${CLI.FUNCTION_LIST}\` shows the IDs.`,
  FUNCTION_GET_SELECT: 'Select a function:',
  FUNCTION_ACTIVATE_SELECT: 'Select a function to activate:',
  FUNCTION_DEACTIVATE_SELECT: 'Select a function to deactivate:',
  FUNCTION_DELETE_SELECT: 'Select a function to delete:',

  // Function activate
  FUNCTION_ACTIVATE_NOT_FOUND: (id: string) => `Brevo Function "${id}" not found.`,
  FUNCTION_ACTIVATE_CARD_TITLE: 'Function Activated',
  FUNCTION_ACTIVATE_CARD_LABEL: 'Status',
  FUNCTION_ACTIVATE_CARD_MESSAGE: (id: string) => `"${id}" is now active and processing data.`,

  // Function deactivate
  FUNCTION_DEACTIVATE_NOT_FOUND: (id: string) => `Brevo Function "${id}" not found.`,
  FUNCTION_DEACTIVATE_CARD_TITLE: 'Function Deactivated',
  FUNCTION_DEACTIVATE_CARD_LABEL: 'Status',
  FUNCTION_DEACTIVATE_CARD_MESSAGE: (id: string) => `"${id}" is now inactive.`,

  // Function delete
  FUNCTION_DELETE_CONFIRM: (id: string) =>
    `Are you sure you want to delete Brevo Function "${id}"? This cannot be undone.`,
  FUNCTION_DELETE_CANCELLED: 'Deletion cancelled.',
  FUNCTION_DELETE_NOT_FOUND: (id: string) => `Brevo Function "${id}" not found.`,
  FUNCTION_DELETE_CARD_TITLE: 'Function Deleted',
  FUNCTION_DELETE_CARD_LABEL: 'Removed',
  FUNCTION_DELETE_CARD_MESSAGE: (id: string) => `"${id}" has been permanently deleted.`,

  // Function init
  FUNCTION_INIT_SELECT_APP: 'Select a Brevo Function app:',
  FUNCTION_INIT_NO_APPS: `No Brevo Function apps found. Create one first with \`${CLI.APP_CREATE}\`.`,
  FUNCTION_INIT_METHOD_PROMPT: 'How would you like to create your function?',
  FUNCTION_INIT_METHOD_AI: 'Generate using AI',
  FUNCTION_INIT_METHOD_TEMPLATE: 'Use a predefined template',
  FUNCTION_INIT_DESCRIPTION_PROMPT: 'Describe what this function should do:',
  FUNCTION_INIT_DESCRIPTION_REQUIRED: 'Description cannot be empty.',
  FUNCTION_INIT_TEMPLATE_PROMPT: 'Select a template:',
  FUNCTION_INIT_NO_TEMPLATES: 'No templates available.',
  FUNCTION_INIT_STAGE_ENRICHING: 'Analyzing the request',
  FUNCTION_INIT_STAGE_PLANNING: 'Contacting databases',
  FUNCTION_INIT_STAGE_GENERATING: 'Creating the function',
  FUNCTION_INIT_STAGE_VALIDATING: 'Testing the function',
  FUNCTION_INIT_GENERATING: 'Generating function...',
  FUNCTION_INIT_ITERATE_PROMPT: 'What would you like to do?',
  FUNCTION_INIT_ITERATE_UPDATE: 'Update / iterate on the prompt',
  FUNCTION_INIT_ITERATE_SAVE: 'Deploy',
  FUNCTION_INIT_ITERATE_DESCRIPTION: 'Describe the changes you want:',
  FUNCTION_INIT_ITERATING: 'Iterating on function...',
  FUNCTION_INIT_SAVE_SPINNER: 'Creating function...',
  FUNCTION_INIT_GENERATION_FAILED: 'Function generation failed.',
  FUNCTION_INIT_GENERATION_ERROR: 'Failed to generate function. Please try again.',
  FUNCTION_INIT_ITERATE_ERROR: 'Failed to update function. Please try again.',
  FUNCTION_INIT_PREVIEW_ERROR: 'Failed to preview function results.',
  FUNCTION_INIT_NON_INTERACTIVE: `\`${CLI.FUNCTION_INIT}\` requires an interactive terminal. It cannot run with --json or piped input.`,
  FUNCTION_INIT_FETCHING_CONTACTS: 'Fetching sample contacts...',
  FUNCTION_INIT_EXECUTING_PREVIEW: 'Previewing function...',
  FUNCTION_INIT_PREVIEW_HEADER: 'Preview results:',
  FUNCTION_INIT_NAME_PROMPT: 'Enter a name for this function:',
  FUNCTION_INIT_NAME_REQUIRED: 'Name cannot be empty.',
  FUNCTION_INIT_DEPLOY_WARNING: 'This will activate the function and run it with real-time data.',
  FUNCTION_INIT_DEPLOY_PROMPT: 'Are you sure you want to deploy?',
  FUNCTION_INIT_NAME_EXISTS:
    'A function with this name already exists. Please choose a different name.',
  FUNCTION_INIT_DEPLOY_CANCELLED: 'Deployment cancelled.',
  FUNCTION_INIT_CREATING_FROM_TEMPLATE: 'Deploying function...',
  FUNCTION_INIT_BOX_TITLE: 'Function deployed',
  FUNCTION_INIT_BOX_ID: (id: string) => `ID:   ${id}`,

  // Function deploy
  FUNCTION_DEPLOY_SELECT: 'Select a draft to deploy:',
  FUNCTION_DEPLOY_NO_DRAFTS:
    'No draft functions found. Create one first with `brevo function init`.',
  FUNCTION_DEPLOY_NON_INTERACTIVE: `Cannot show the draft picker in non-interactive mode. Pass the draft ID instead:\n\n      ${CLI.FUNCTION_DEPLOY}\n\n  \`${CLI.FUNCTION_LIST} --draft\` shows the IDs.`,
  FUNCTION_DEPLOY_NOT_FOUND: (id: string) => `Draft "${id}" not found.`,
  FUNCTION_DEPLOY_PREVIEW_HEADER: 'Preview results:',
  FUNCTION_DEPLOY_PREVIEW_ERROR: 'Failed to preview draft results.',
  FUNCTION_DEPLOY_NAME_PROMPT: 'Enter a name for this function:',
  FUNCTION_DEPLOY_NAME_REQUIRED: 'Name cannot be empty.',
  FUNCTION_DEPLOY_WARNING: 'This will activate the function and run it with real-time data.',
  FUNCTION_DEPLOY_CONFIRM: 'Are you sure you want to deploy?',
  FUNCTION_DEPLOY_CANCELLED: 'Deployment cancelled.',
  FUNCTION_DEPLOY_SPINNER: 'Deploying function...',
  FUNCTION_DEPLOY_NAME_EXISTS:
    'A function with this name already exists. Please choose a different name.',
  FUNCTION_DEPLOY_BOX_TITLE: 'Function deployed',
  FUNCTION_DEPLOY_BOX_ID: (id: string) => `ID:   ${id}`,
  FUNCTION_DEPLOY_FETCHING_CONTACTS: 'Fetching sample contacts...',
  FUNCTION_DEPLOY_EXECUTING_PREVIEW: 'Previewing function...',

  // Function preview — shared across init and deploy
  FUNCTION_PREVIEW_EXECUTE_FAILED: 'Unable to deploy function.',
} as const;
