/**
 * The shared command tail: what `app create` and `app scaffold`'s bootstrap both do once
 * the base project is on disk and reported.
 *
 * Its own module rather than part of `./project-writer` because the two are different
 * kinds of thing. The writer is primitives — render templates, write files, report what
 * landed — and knows nothing about a flow. This is the flow: it asks questions, branches
 * on the app type, and decides what to write next. Keeping them apart means a command can
 * take the primitives without the flow, which `app scaffold`'s feature-add path does.
 */
import { logInfo } from '../../lib/logger';
import { printBox } from '../../lib/ui';
import { messages } from '../../lang/en';
import { FeatureType } from '../../templates';
import { promptFeatureType, promptScaffoldFeature } from './scaffold-prompts';
import {
  AppContext,
  runFeatureScaffold,
  resolveFeatureConflict,
  reportScaffoldSuccess,
} from './project-writer';

/**
 * Everything a command does once the base project is on disk and reported: the UI-app
 * terminal message, the feature offer, the conflict question, the feature write and its
 * report.
 *
 * `app create` and `app scaffold`'s bootstrap had this tail twice, near-identically —
 * two commands whose only real difference is how they *obtain* the app (one registers
 * it, one looks it up) had diverging answers to what happens afterwards. The base write
 * itself stays with each caller: they genuinely differ there (create must not print
 * under `--json`, and bootstrap defers the write off a TTY), and forcing that half
 * through here would need more flags than it would save.
 *
 * Prompts only when `offerFeature` is set. A caller passes `false` for a run that must
 * not block — `--json`, or a piped stdin — and gets `{ feature: null }` back without a
 * question having been asked.
 */
export interface FinishProjectParams {
  appId: string;
  ctx: AppContext;
  targetDir: string;
  /** Scopes from the base write, carried into the feature report. */
  baseScopes: string[];
  cdDir?: string;
  /** UI apps have no scaffoldable feature — an action link has no local server. */
  isUiApp: boolean;
  /** Ask "scaffold a feature?" at all. False for `--json` and non-TTY runs. */
  offerFeature: boolean;
  /**
   * What to do when the feature's files are already on disk.
   *
   * `'ask'` runs the overwrite / merge / cancel question (`app scaffold`, which is
   * routinely pointed at a populated directory). `'merge'` and `'overwrite'` skip it and
   * state the answer — `app create` passes the directory decision it already took, because
   * the user has just answered that exact question about this exact directory.
   */
  onConflict: 'ask' | 'merge' | 'overwrite';
  /** Forwarded to the conflict question; only read when `onConflict` is `'ask'`. */
  jsonMode?: boolean;
  overwriteFlag?: boolean;
}

export type FinishProjectResult =
  | { cancelled: true }
  | { cancelled: false; feature: FeatureType | null; written: number };

export async function finishProject(params: FinishProjectParams): Promise<FinishProjectResult> {
  const { appId, ctx, targetDir, cdDir, isUiApp } = params;

  // No feature to offer, so this is the end of the road: name what comes next
  // (upload → deploy) rather than the OAuth test server the app can't use.
  if (isUiApp) {
    printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_UI_NEXT(cdDir));
    return { cancelled: false, feature: null, written: 0 };
  }

  const wanted = params.offerFeature && (await promptScaffoldFeature());
  if (!wanted) {
    logInfo(messages.APP_SCAFFOLD_SCOPES_TIP);
    printBox(messages.APP_SCAFFOLD_NEXT_STEPS_TITLE, messages.APP_CREATE_BASE_ONLY_NEXT(cdDir));
    return { cancelled: false, feature: null, written: 0 };
  }

  const feature = await promptFeatureType(true);

  let mergeOnly: boolean;
  if (params.onConflict === 'ask') {
    const choice = await resolveFeatureConflict(feature, appId, ctx, targetDir, {
      jsonMode: !!params.jsonMode,
      overwrite: !!params.overwriteFlag,
    });
    if (choice === 'cancel') {
      logInfo(messages.APP_SCAFFOLD_CANCELLED);
      return { cancelled: true };
    }
    mergeOnly = choice === 'merge';
  } else {
    mergeOnly = params.onConflict === 'merge';
  }

  const feat = runFeatureScaffold(feature, appId, ctx, targetDir, mergeOnly);
  reportScaffoldSuccess({
    written: feat.written,
    // Any legacy-'all' substitution was already surfaced by the base report, which every
    // caller prints before getting here — repeating it would warn twice for one config.
    legacyAllSubstituted: false,
    scopes: params.baseScopes,
    files: feat.files,
    targetDir,
    cdDir,
  });
  return { cancelled: false, feature, written: feat.written };
}
