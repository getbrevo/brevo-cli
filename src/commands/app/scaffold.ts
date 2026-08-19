/**
 * `brevo app scaffold` — the command.
 *
 * Two modes, chosen by whether cwd holds an `app-config.json`: with one it adds a feature
 * to the linked app, without one it *bootstraps* a directory for an app that already
 * exists. What both modes have in common — fetching the app, resolving a directory,
 * writing the files — lives in `./project-writer`, and everything both do *after* the
 * base project lands (offer the feature, resolve a conflict, write it, report) lives in
 * `./finish-project`. Both are shared with `app create`, which reaches the same tail once
 * its app exists. This file is only the part that decides WHICH app and WHETHER to write.
 */
import inquirer from 'inquirer';
import { logSuccess, logInfo } from '../../lib/logger';
import { printBox } from '../../lib/ui';
import { messages } from '../../lang/en';
import { withCommandHandler } from '../../lib/command-handler';
import { CliError } from '../../lib/errors';
import { jsonOutput } from '../../lib/json-output';
import {
  readProjectConfig,
  readProjectConfigAt,
  findEnclosingProjectDir,
  ProjectConfig,
  isUiAppConfig,
} from '../../lib/config';
import { resolveFromRecord } from '../../app-types';
import { stripUiAppWireOnlyKeys } from '../../app-types/wire';
import { promptAppSelection } from './select-app';
import { promptFeatureType } from './scaffold-prompts';
// The project writer. `app create` imports the same module directly — neither command
// reaches the other, which is the point of the split.
import {
  AppContext,
  ConfigDiff,
  computeSlug,
  diffLocalConfig,
  fetchAppContext,
  resolveProjectDirectory,
  applyProjectDirectory,
  runBaseScaffold,
  runFeatureScaffold,
  resolveFeatureConflict,
  reportBaseScaffoldSuccess,
  reportScaffoldSuccess,
  computeCdHint,
  printFileTree,
} from './project-writer';
import { finishProject } from './finish-project';

// Resolve which app this project is linked to (from cwd's app-config.json),
// and decide whether the base config has drifted from the server. Returns a
// cancellation instead of prompting when running under --json.
interface ScaffoldPlanResolved {
  cancelled: false;
  appId: string;
  ctx: AppContext;
  refreshBase: boolean;
}

interface ScaffoldPlanCancelled {
  cancelled: true;
  reason?: string;
  diffs?: ConfigDiff[];
}

type ScaffoldPlan = ScaffoldPlanResolved | ScaffoldPlanCancelled;

type BaseRefreshDecision = { cancelled: false; refreshBase: boolean } | ScaffoldPlanCancelled;

/**
 * Diff a config that is already on disk against the server, and decide whether to
 * rewrite it.
 *
 * Shared by both modes, because both can end up holding one. The feature-add path
 * always does — a local config is what puts it in that mode. A bootstrap does whenever
 * the directory it was pointed at turns out to hold a project already, which is the
 * common way to run it: someone re-running `app scaffold` over the folder they made
 * last week. That case used to skip this question entirely and take the *directory*
 * prompt's merge answer instead, which silently dropped the whole refresh — see the
 * call site.
 *
 * The outcome is a full overwrite or nothing, never a merge: merging keeps the file
 * that exists, which is precisely the file a refresh has to rewrite.
 */
async function resolveBaseRefresh(
  localConfig: ProjectConfig,
  ctx: AppContext,
  jsonMode: boolean,
): Promise<BaseRefreshDecision> {
  const diffs = diffLocalConfig(localConfig, ctx);

  // No drift → nothing to refresh; just add the feature.
  if (diffs.length === 0) {
    return { cancelled: false, refreshBase: false };
  }

  // --json can't prompt for confirmation — decline and surface the diffs so a
  // script can decide how to proceed.
  if (jsonMode) {
    return { cancelled: true, reason: messages.APP_SCAFFOLD_JSON_DIFF_CANCELLED, diffs };
  }

  logInfo(messages.APP_SCAFFOLD_DIFF_INTRO(localConfig.appName || localConfig.appId));
  for (const diff of diffs) {
    logInfo(messages.APP_SCAFFOLD_DIFF_LINE(diff.field, diff.local, diff.server));
  }
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: messages.APP_SCAFFOLD_DIFF_CONFIRM,
      default: true,
    },
  ]);
  if (!confirmed) return { cancelled: true };
  return { cancelled: false, refreshBase: true };
}

async function resolveScaffoldPlan(
  localConfig: ProjectConfig,
  jsonMode: boolean,
): Promise<ScaffoldPlan> {
  const appId = localConfig.appId;
  // Carry the local `ui_app` block into the context so that if the user consents
  // to a config refresh, `runBaseScaffold` rewrites app-config.json *with* it
  // rather than dropping it (the refresh is a full overwrite, not a merge).
  const ctx = await fetchAppContext(appId, jsonMode, localConfig.ui_app);
  const refresh = await resolveBaseRefresh(localConfig, ctx, jsonMode);
  if (refresh.cancelled) return refresh;
  return { cancelled: false, appId, ctx, refreshBase: refresh.refreshBase };
}

// Set an empty directory up for an app that already exists on the platform.
//
// Unlike `resolveScaffoldPlan` there is nothing local to diff against, so there is
// no drift question to ask and `refreshBase` is unconditionally true — writing
// app-config.json is the point of the command in this mode, not a side effect of
// consenting to a refresh.
//
// This is also the one place the *server* is authoritative about the app type.
// `fetchAppContext` deliberately ignores `appDetails.ui_app` and takes the block
// from its caller, because its two original callers both knew the type locally and
// stale server data must not reclassify an app. Bootstrapping knows nothing
// locally — that is its premise — so the server's answer is the only one there is,
// and taking it is the same choice those callers made, not an exception to it.
async function resolveBootstrapPlan(appId: string, jsonMode: boolean): Promise<ScaffoldPlan> {
  if (!jsonMode) logInfo(messages.APP_SCAFFOLD_BOOTSTRAP_INTRO(appId));
  const probe = await fetchAppContext(appId, jsonMode);
  const record = probe.appDetails;

  // Refuse before writing anything when the server cannot answer with enough to rebuild
  // a complete app-config.json.
  //
  // Reachable through the app-type classifier, not through anything the server does with
  // snapshots: `isUiAppRecordShape` calls a record a UI app whenever it carries no OAuth
  // material, block or no block, so a record with neither is classified `ui` and lands
  // here with nothing to write. See `recoverableFromRecord` in `src/app-types/ui/index.ts`.
  //
  // This used to name a different case — "a UI app created but never uploaded" — on the
  // belief that the read endpoint could only source `ui_app` from an upload snapshot. That
  // was wrong: create writes the snapshot in its own transaction, so such an app does come
  // back with its block.
  //
  // It has to be a refusal rather than a partial write, because the omission is invisible.
  // The presence of `ui_app` IS the app-type discriminator, so a config written without it
  // does not read as an incomplete UI app — it reads as a perfectly valid OAuth one, and
  // the next `app upload` pushes an `auth` block where `ui_app` belonged.
  //
  // Asked of the app type rather than tested inline as `!record.ui_app`, so a third type
  // answers the same question instead of needing someone to find this branch by hand.
  // Skipped entirely when there is no record at all: that is a fetch failure, which
  // `fetchAppContext` has already reported on its own terms.
  const appType = resolveFromRecord(record);
  if (record && !appType.recoverableFromRecord(record)) {
    throw new CliError(messages.APP_SCAFFOLD_BOOTSTRAP_UNRECOVERABLE(appId));
  }

  // Strip the keys the platform owns before the block reaches app-config.json — it
  // injects `link_target`, manages the snapshot `version`, and stamps the dotted
  // `extension_point_name` onto every entry. None is authored, and writing one into the
  // file puts a value there that the very next `app upload` rejects as an unknown key.
  // Same owner the upload diff and write-back use; see `src/app-types/wire.ts`.
  const serverUiApp = record?.ui_app ? stripUiAppWireOnlyKeys(record.ui_app) : undefined;
  const ctx = serverUiApp ? { ...probe, uiApp: serverUiApp } : probe;
  return { cancelled: false, appId, ctx, refreshBase: true };
}

/**
 * Which app should an empty directory be set up for?
 *
 * `--app-id` wins when given — it is the non-interactive entry point and the migration
 * path off `brevo app update --app-id <id>`. Without it, an interactive run picks from
 * the account's apps, because a user who has lost their project folder (fresh clone, new
 * laptop, a create that ran in CI) has the app but not necessarily its ID.
 *
 * Falls back to the no-config error whenever prompting is impossible — under `--json` or
 * off a TTY — rather than picking an app on the user's behalf. That error already names
 * `--app-id`, which is the answer for those cases.
 */
async function resolveBootstrapAppId(
  requestedAppId: string | undefined,
  jsonMode: boolean,
): Promise<string | undefined> {
  if (requestedAppId) return requestedAppId;
  if (jsonMode || !process.stdin.isTTY) {
    throw new CliError(messages.APP_SCAFFOLD_NO_CONFIG);
  }
  // Asked before the picker rather than opening straight into it. Bootstrapping is
  // not what `scaffold` normally does, and the most common way to arrive here is a
  // mistyped `cd` — for that user the list of their apps is a non-sequitur, and the
  // useful answer is "no". Returning `undefined` for a decline keeps that a normal
  // outcome rather than an error the caller has to recognise.
  logInfo(messages.APP_SCAFFOLD_BOOTSTRAP_OFFER);
  const { useExisting } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useExisting',
      message: messages.APP_SCAFFOLD_BOOTSTRAP_CONFIRM,
      default: true,
    },
  ]);
  if (!useExisting) return undefined;
  const { appId } = await promptAppSelection(messages.APP_SCAFFOLD_SELECT);
  return appId;
}

/**
 * Where should a bootstrap write?
 *
 * The feature-add path has no question to answer — its directory is the project it
 * was run in. A bootstrap does: it is the one `scaffold` entry point that can be
 * invoked from a directory the user never meant to fill, and the most likely such
 * directory is the folder they keep their apps *in*. Writing eleven files
 * (`app-config.json`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, the
 * OAuth server) straight into that folder is silent and tedious to undo, so the
 * command asks the same question `app create` asks, with the same default —
 * `./<slug of the app's name>` — and the same escape: type `.` to stay put.
 *
 * Interactive only. Under `--json` or off a TTY the answer stays the current
 * directory, because `scaffold --app-id <id>` is the scripted migration path off
 * `app update --app-id` and a pipeline that already `mkdir`s and `cd`s must not
 * start finding its config one level deeper. `resolveProjectDirectory` would not
 * prompt in that mode anyway — it would take the default, which is exactly the
 * relocation we must not do.
 */
async function resolveBootstrapDirectory(
  ctx: AppContext,
  jsonMode: boolean,
  appId: string,
): Promise<{ targetDir: string; mergeOnly: boolean } | undefined> {
  if (jsonMode || !process.stdin.isTTY) return undefined;

  // Refuse a target that is already *another* app's project, and do it before the
  // Overwrite / Merge question rather than after: writing this app's credentials into
  // that directory would leave a project whose app-config.json and src/oauth/.env.local
  // name two different apps, so there is nothing to ask about. The `--app-id` mismatch
  // guard cannot catch this — it compares against the current directory, and this target
  // is elsewhere. A target holding *this* app's project is fine and is resolved as a
  // refresh by the caller.
  const refuseIfLinkedElsewhere = (targetDir: string): void => {
    const targetConfig = readProjectConfigAt(targetDir);
    if (targetConfig && targetConfig.appId !== appId) {
      throw new CliError(
        messages.APP_SCAFFOLD_TARGET_LINKED_ELSEWHERE(targetDir, targetConfig.appId, appId),
      );
    }
  };

  const defaultDir = `./${computeSlug(ctx.appDetails?.name)}`;
  let dir = await resolveProjectDirectory(defaultDir, false, refuseIfLinkedElsewhere);
  while (!dir.unresolved && dir.chooseAgain) {
    dir = await resolveProjectDirectory(defaultDir, false, refuseIfLinkedElsewhere);
  }
  if (dir.unresolved) {
    // Unreachable: `unresolved` is only ever returned with jsonMode=true, which
    // returned above. Fail loudly rather than guess if that ever changes.
    throw new CliError(messages.APP_CREATE_DIR_UNRESOLVED);
  }
  // Safe to create and move into it immediately: unlike `app create`, nothing has
  // been registered on the server that a later failure could orphan — the app
  // already exists and this command only writes files.
  applyProjectDirectory(dir);
  return { targetDir: dir.targetDir, mergeOnly: dir.mergeOnly };
}

/** The user turned the bootstrap offer down — distinct from "there is nothing to bootstrap". */
const BOOTSTRAP_DECLINED = Symbol('bootstrap-declined');

/**
 * Which app the run is for, before anything is fetched or written.
 *
 * Two mutually exclusive pre-flights — a run either has a local config or it doesn't — so
 * they live together even though only one applies. Returns the app to bootstrap,
 * `undefined` when there is a local config (nothing to bootstrap), or `BOOTSTRAP_DECLINED`.
 */
async function resolveBootstrapTarget(
  localConfig: ProjectConfig | null,
  requestedAppId: string | undefined,
  jsonMode: boolean,
): Promise<string | undefined | typeof BOOTSTRAP_DECLINED> {
  if (localConfig) {
    // Checked before any fetch or write: pointing `--app-id` at a directory that
    // belongs to another app is a mistake worth catching for free, and a bootstrap
    // here would overwrite that app's app-config.json with a different app's.
    if (requestedAppId && localConfig.appId !== requestedAppId) {
      throw new CliError(messages.APP_SCAFFOLD_APP_ID_MISMATCH(localConfig.appId, requestedAppId));
    }
    return undefined;
  }

  // `readProjectConfig` reads cwd and deliberately does not walk up, which makes a
  // directory one level inside a project indistinguishable from an empty one
  // outside it. They must not get the same answer: bootstrapping into `myapp/src/`
  // would leave a second app-config.json nested in the first, after which
  // `app upload` from that directory pushes the wrong app with no warning. Checked
  // before the picker so the user is told what is wrong rather than being asked to
  // choose an app the command will not use.
  const enclosingProject = findEnclosingProjectDir();
  if (enclosingProject) {
    throw new CliError(messages.APP_SCAFFOLD_INSIDE_PROJECT(enclosingProject));
  }
  return (await resolveBootstrapAppId(requestedAppId, jsonMode)) || BOOTSTRAP_DECLINED;
}

function reportPlanCancelled(plan: ScaffoldPlanCancelled, jsonMode: boolean): void {
  if (jsonMode) {
    jsonOutput({
      cancelled: true,
      ...(plan.reason ? { reason: plan.reason } : {}),
      ...(plan.diffs ? { diffs: plan.diffs } : {}),
    });
    return;
  }
  logInfo(messages.APP_SCAFFOLD_CANCELLED);
}

/** Where the files land, and whether the base is rewritten when they do. */
interface ScaffoldLayout {
  targetDir: string;
  cdDir: string | undefined;
  refreshBase: boolean;
  baseMergeOnly: boolean;
}

/**
 * Resolve the target directory and settle the base-refresh question for it.
 *
 * `null` means the user cancelled.
 */
async function resolveScaffoldLayout(
  localConfig: ProjectConfig | null,
  appId: string,
  ctx: AppContext,
  planRefreshBase: boolean,
  jsonMode: boolean,
): Promise<ScaffoldLayout | null> {
  // Captured before `resolveBootstrapDirectory` may chdir: the `cd` hint has to
  // be relative to the shell the user typed the command in, not to the directory
  // the CLI has since moved its own process into.
  const originalCwd = process.cwd();
  const bootstrapDir = localConfig
    ? undefined
    : await resolveBootstrapDirectory(ctx, jsonMode, appId);
  const targetDir = bootstrapDir?.targetDir ?? process.cwd();
  // `cd` is only worth printing when the files did not land where the user is
  // standing; `computeCdHint` returns undefined for the directory they're in.
  const cdDir = bootstrapDir ? computeCdHint(originalCwd, targetDir) : undefined;
  // Merging the *base* files is the directory decision's call, not the feature
  // prompt's — it answers "this directory already had files in it", which only a
  // bootstrap that was pointed at a non-empty directory can hit. The feature-add
  // path keeps its full overwrite: a consented refresh means "make it match the
  // server", which a merge would quietly not do.
  let baseMergeOnly = bootstrapDir?.mergeOnly ?? false;
  let refreshBase = planRefreshBase;

  // A bootstrap pointed at a directory that already holds a project is a *refresh*,
  // and has to be resolved as one rather than left to the directory prompt's
  // merge answer.
  //
  // Those two answer different questions. "Merge (keep existing, add missing)" is
  // about not clobbering the user's own files, and `writeScaffoldFiles` implements it
  // by skipping any path that exists. app-config.json always exists in this case, so
  // merging skipped the one file the bootstrap exists to write — the command fetched
  // the app, discarded every field of it, wrote nothing, and printed the success box
  // anyway. `resolveBootstrapPlan` sets `refreshBase` unconditionally *because*
  // writing that file is the whole command; the merge flag was quietly overruling it.
  //
  // So ask the question the feature-add path asks — show the drift, confirm, then
  // fully overwrite — and drop the merge flag once a refresh is agreed, since a merge
  // cannot carry one out. The directory answer still governs a target that has files
  // but no config (a fresh clone, an empty git repo): app-config.json doesn't exist
  // there, so it is written either way and the user's other files stay untouched.
  //
  // Only reachable when a directory was resolved: without one the target is cwd, and
  // cwd having no config is what selected this branch in the first place.
  // A target belonging to a *different* app was already refused inside
  // `resolveBootstrapDirectory`, before the merge question. What can still be here is
  // this same app's project, which is a refresh.
  if (bootstrapDir) {
    const targetConfig = readProjectConfigAt(targetDir);
    if (targetConfig) {
      const refresh = await resolveBaseRefresh(targetConfig, ctx, jsonMode);
      // Always the interactive decline, never the `--json` one: this branch needs a
      // resolved directory, and `resolveBootstrapDirectory` returns none under
      // `--json` or off a TTY. So there is no machine-readable cancellation to emit.
      if (refresh.cancelled) return null;
      refreshBase = refresh.refreshBase;
      // Only drop the merge flag when a refresh is actually going ahead, because
      // dropping it is what allows app-config.json to be rewritten. With no drift
      // there is nothing to rewrite, and clearing it anyway would overwrite a file
      // that already matches the server — reintroducing a write this branch exists to
      // make deliberate.
      if (refresh.refreshBase) baseMergeOnly = false;
    }
  }

  return { targetDir, cdDir, refreshBase, baseMergeOnly };
}

/**
 * A UI app has no scaffoldable features, so the command is just a base-config refresh.
 */
function finishUiAppScaffold(
  appId: string,
  ctx: AppContext,
  layout: ScaffoldLayout,
  jsonMode: boolean,
): void {
  const { targetDir, cdDir, refreshBase, baseMergeOnly } = layout;
  const base = refreshBase ? runBaseScaffold(appId, ctx, targetDir, baseMergeOnly) : null;
  if (jsonMode) {
    jsonOutput({
      scaffolded: base?.written ?? 0,
      directory: targetDir,
      features: [],
      reason: messages.APP_SCAFFOLD_NO_FEATURES_FOR_UI_APP,
    });
    return;
  }
  if (base) {
    logSuccess(messages.APP_CREATE_BASE_SUCCESS(base.written, base.files.length));
    printFileTree(base.files.map((f) => f.name));
  }
  logInfo(messages.APP_SCAFFOLD_NO_FEATURES_FOR_UI_APP);
  // A bootstrap that made its own directory has to say which one, and for a UI
  // app upload → deploy is the whole of what comes next.
  if (cdDir) printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_UI_NEXT(cdDir));
}

/**
 * An interactive bootstrap: write and report the project, then hand off to the shared tail.
 */
async function finishInteractiveBootstrap(
  appId: string,
  ctx: AppContext,
  layout: ScaffoldLayout,
  jsonMode: boolean,
  overwrite: boolean,
): Promise<void> {
  const { targetDir, cdDir, refreshBase, baseMergeOnly } = layout;
  // `refreshBase` is false in exactly one case here: the target directory already
  // held a config and it already matches the server, so there is nothing to
  // rewrite. Say so instead of writing — a blind overwrite would regenerate
  // README.md/CLAUDE.md/AGENTS.md over the user's edits to report that nothing
  // needed changing. Every other bootstrap still writes unconditionally, which is
  // the point of the mode.
  const bootstrapBase = refreshBase ? runBaseScaffold(appId, ctx, targetDir, baseMergeOnly) : null;
  if (bootstrapBase) reportBaseScaffoldSuccess(bootstrapBase);
  else logInfo(messages.APP_SCAFFOLD_BASE_IN_SYNC);
  // The rest of a bootstrap is the same tail `app create` runs once its app exists —
  // offer the feature, resolve a conflict, write, report — so it runs the shared one
  // in `./finish-project` rather than a second copy of it here. `'ask'` because this
  // command is routinely pointed at a directory that already has files in it; create
  // passes the answer it already has.
  await finishProject({
    appId,
    ctx,
    targetDir,
    baseScopes: bootstrapBase?.scopes ?? [],
    cdDir,
    // A bootstrapped UI app is already handled by the caller, so this is always an OAuth app.
    isUiApp: false,
    offerFeature: true,
    onConflict: 'ask',
    jsonMode,
    overwriteFlag: overwrite,
  });
}

/**
 * The feature-add path, and any bootstrap that cannot prompt (`--json`, or off a TTY).
 */
async function finishFeatureScaffold(
  appId: string,
  ctx: AppContext,
  layout: ScaffoldLayout,
  jsonMode: boolean,
  overwrite: boolean,
): Promise<void> {
  const { targetDir, cdDir, refreshBase, baseMergeOnly } = layout;
  const feature = await promptFeatureType(!jsonMode);

  // Decide how existing feature files are handled (overwrite/merge/cancel)
  // before writing anything.
  const conflict = await resolveFeatureConflict(feature, appId, ctx, targetDir, {
    jsonMode,
    overwrite,
  });
  if (conflict === 'cancel') {
    logInfo(messages.APP_SCAFFOLD_CANCELLED);
    return;
  }
  const featureMergeOnly = conflict === 'merge';

  // Refresh the base config/meta files (full overwrite) only when the local
  // config drifted from the server and the user consented.
  //
  // Only the feature-add path and non-interactive bootstraps reach here: an
  // interactive bootstrap wrote and reported its base already and then returned
  // through `finishProject`, so there is no "already written" case left to carry.
  const base = refreshBase ? runBaseScaffold(appId, ctx, targetDir, baseMergeOnly) : null;

  // Feature files merge by default (never clobber hand-edited code); the user
  // (or --overwrite) can opt into a full overwrite via resolveFeatureConflict.
  const feat = runFeatureScaffold(feature, appId, ctx, targetDir, featureMergeOnly);

  const written = (base?.written ?? 0) + feat.written;
  const files = [...(base?.files ?? []), ...feat.files];

  if (jsonMode) {
    jsonOutput({ scaffolded: written, directory: targetDir });
    return;
  }

  // `cdDir` is set only when a bootstrap made (or was pointed at) a directory
  // other than the one the command was typed in; the feature-add path always
  // writes into the project directory, so it stays undefined there.
  reportScaffoldSuccess({
    written,
    legacyAllSubstituted: base?.legacyAllSubstituted ?? false,
    scopes: base?.scopes ?? [],
    files,
    targetDir,
    cdDir,
  });
}

export const scaffoldCommand = withCommandHandler(
  async (options: { json?: boolean; overwrite?: boolean; appId?: string }): Promise<void> => {
    const jsonMode = !!options.json;
    const overwrite = !!options.overwrite;
    const requestedAppId = options.appId?.trim() || undefined;

    // Scaffolding a feature only makes sense inside an already-created project —
    // unless we are setting the directory up for an app that already exists, either
    // named by `--app-id` or chosen from the picker.
    const localConfig = readProjectConfig();

    const bootstrapAppId = await resolveBootstrapTarget(localConfig, requestedAppId, jsonMode);
    // Declined the offer: nothing to scaffold and nothing went wrong, so exit 0
    // with the remaining routes on screen rather than raising the no-config error
    // the user has just been shown a friendlier version of.
    if (bootstrapAppId === BOOTSTRAP_DECLINED) {
      logInfo(messages.APP_SCAFFOLD_BOOTSTRAP_DECLINED);
      return;
    }

    const plan = localConfig
      ? await resolveScaffoldPlan(localConfig, jsonMode)
      : await resolveBootstrapPlan(bootstrapAppId!, jsonMode);
    if (plan.cancelled) {
      reportPlanCancelled(plan, jsonMode);
      return;
    }

    const { appId, ctx } = plan;

    const layout = await resolveScaffoldLayout(localConfig, appId, ctx, plan.refreshBase, jsonMode);
    if (!layout) {
      logInfo(messages.APP_SCAFFOLD_CANCELLED);
      return;
    }

    // UI apps have no scaffoldable features — there is no local server to run for
    // an action link. `app scaffold` degrades to a base-config refresh so the
    // command still has a use inside a UI-app project, instead of offering an
    // OAuth test server the app can't use.
    //
    // Bootstrapping has no local config to classify, so it falls back to the block
    // `resolveBootstrapPlan` read off the server; the two agree on the linked path,
    // where `ctx.uiApp` is the local block by construction.
    const isUiApp = localConfig ? isUiAppConfig(localConfig) : Boolean(ctx.uiApp);
    if (isUiApp) {
      finishUiAppScaffold(appId, ctx, layout, jsonMode);
      return;
    }

    // A bootstrap writes and reports the project *before* asking about the feature:
    // the project is what the command was asked for, so it should exist whatever the
    // answer is, and the user can see what they got before deciding on the extra.
    // (The feature-add mode never asks — there, the feature *is* the request — and
    // `--json` never prompts, so both keep writing the base further down.)
    // Gated on a TTY, not just on `--json`, for the same reason the directory
    // question is: it is a new blocking prompt, and a piped run must keep finishing
    // on its own. Off a TTY the base is written further down and the feature always
    // follows, exactly as before.
    const bootstrapInteractive = !localConfig && !jsonMode && !!process.stdin.isTTY;
    if (bootstrapInteractive) {
      await finishInteractiveBootstrap(appId, ctx, layout, jsonMode, overwrite);
      return;
    }

    await finishFeatureScaffold(appId, ctx, layout, jsonMode, overwrite);
  },
);
