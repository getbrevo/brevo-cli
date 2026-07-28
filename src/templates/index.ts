import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_DIR = path.resolve(__dirname, 'files');

/**
 * Read a .tmpl file from the templates/files directory.
 * Resolved at runtime so template files can be edited without recompiling.
 */
function loadTemplate(relativePath: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, relativePath), 'utf-8');
}

/**
 * Replace all occurrences of the given keys in a template string.
 * Keys should include delimiters (e.g. '{{APP_NAME}}').
 */
export function applyVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export type Distribution = 'public' | 'private';

/**
 * Conditional flags a template can branch on.
 *
 * - `public` / `private` — the app's distribution type (PKCE vs confidential
 *   OAuth flow).
 * - `oauth` / `ui_app` — the app *type* (BEX-290). Exactly one is always set,
 *   so a template can carry OAuth-only and UI-app-only sections side by side.
 */
export type TemplateFlag = 'public' | 'private' | 'oauth' | 'ui_app';

const IF_OPEN_RE = /^\s*\{\{#if (public|private|oauth|ui_app)\}\}\s*$/;
const IF_CLOSE_RE = /^\s*\{\{\/if\}\}\s*$/;

/**
 * Strip conditional blocks from a template.
 *
 * Blocks are delimited by whole-line markers:
 *
 *   {{#if public}}
 *   ...lines emitted only for public apps...
 *   {{/if}}
 *   {{#if ui_app}}
 *   ...lines emitted only for UI apps...
 *   {{/if}}
 *
 * A block's body is kept only when its flag is in `flags`; otherwise the whole
 * block is dropped. Blocks may nest. The marker lines are always removed in full
 * (including their line break), so a template whose only markers wrap the
 * *matching* branch renders byte-for-byte identically to one written without any
 * markers — this is what keeps private-app scaffolds unchanged from before PKCE
 * branching was introduced, and what keeps OAuth scaffolds unchanged from before
 * UI-app branching was introduced.
 *
 * Accepts a bare `Distribution` for backwards compatibility with existing
 * callers and tests that predate the app-type flags.
 *
 * `{{DISTRIBUTION}}` and other `{{VAR}}` placeholders are left untouched here;
 * they are resolved separately by {@link applyVars}.
 */
export function applyConditionals(
  template: string,
  flags: Distribution | ReadonlySet<TemplateFlag>,
): string {
  const activeFlags: ReadonlySet<TemplateFlag> =
    typeof flags === 'string' ? new Set<TemplateFlag>([flags]) : flags;
  const lines = template.split('\n');
  const out: string[] = [];
  // Stack of block states; `keep` is false once any enclosing block excludes us.
  const stack: boolean[] = [];
  const active = (): boolean => stack.length === 0 || stack[stack.length - 1] === true;

  for (const line of lines) {
    const open = IF_OPEN_RE.exec(line);
    if (open) {
      stack.push(active() && activeFlags.has(open[1] as TemplateFlag));
      continue;
    }
    if (IF_CLOSE_RE.test(line)) {
      if (stack.length === 0) {
        throw new Error('applyConditionals: unmatched {{/if}}');
      }
      stack.pop();
      continue;
    }
    if (active()) {
      out.push(line);
    }
  }

  if (stack.length > 0) {
    throw new Error('applyConditionals: unclosed {{#if}}');
  }
  return out.join('\n');
}

/**
 * Scaffold file manifest — maps output file paths to their .tmpl source files.
 * Add new templates here; the scaffold command picks them up automatically.
 */
export interface TemplateFile {
  /** Relative output path inside the scaffolded project */
  outputPath: string;
  /** Relative path inside templates/files/ */
  templatePath: string;
}

// The basic project structure written by `brevo app create` — the linked-app
// config plus project meta/docs. No feature-specific code lives here.
export const BASE_TEMPLATE_MANIFEST: TemplateFile[] = [
  { outputPath: 'app-config.json', templatePath: 'app-config.json.tmpl' },
  { outputPath: '.gitignore', templatePath: 'gitignore.tmpl' },
  { outputPath: 'AGENTS.md', templatePath: 'AGENTS.md.tmpl' },
  { outputPath: 'CLAUDE.md', templatePath: 'CLAUDE.md.tmpl' },
  { outputPath: 'README.md', templatePath: 'README.md.tmpl' },
];

// Feature code written by `brevo app scaffold` (or `create`'s optional
// follow-up), keyed by feature type. 'oauth' is the only feature today —
// the "Test OAuth App" local callback server.
export const FEATURE_TEMPLATE_MANIFESTS: Record<'oauth', TemplateFile[]> = {
  oauth: [
    { outputPath: 'src/oauth/server.js', templatePath: 'src/oauth/server.js.tmpl' },
    { outputPath: 'src/oauth/handler.js', templatePath: 'src/oauth/handler.js.tmpl' },
    {
      outputPath: 'src/oauth/token-store.js',
      templatePath: 'src/oauth/token-store.js.tmpl',
    },
    {
      outputPath: 'src/oauth/.env.example',
      templatePath: 'src/oauth/.env.example.tmpl',
    },
    { outputPath: 'src/oauth/.env.local', templatePath: 'src/oauth/.env.local.tmpl' },
    {
      outputPath: 'src/oauth/package.json',
      templatePath: 'src/oauth/package.json.tmpl',
    },
  ],
};

export type FeatureType = keyof typeof FEATURE_TEMPLATE_MANIFESTS;

/**
 * Derive the conditional flag set from the template vars.
 *
 * Distribution: public apps get a PKCE (RFC 7636) OAuth flow with no client
 * secret, private apps keep the confidential-client flow. `{{DISTRIBUTION}}` is
 * always set by buildTemplateVars; default to the (unchanged) private flow if
 * it's absent.
 *
 * App type: `{{UI_APP_JSON}}` is non-empty only for UI apps, so its presence is
 * the discriminator — mirroring how `ui_app` in app-config.json discriminates
 * at runtime (see `isUiAppConfig`).
 */
function resolveTemplateFlags(vars: Record<string, string>): Set<TemplateFlag> {
  const distribution: Distribution = vars['{{DISTRIBUTION}}'] === 'public' ? 'public' : 'private';
  const isUiApp = !!vars['{{UI_APP_JSON}}'];
  return new Set<TemplateFlag>([distribution, isUiApp ? 'ui_app' : 'oauth']);
}

function loadManifest(
  manifest: TemplateFile[],
  vars: Record<string, string>,
): Array<{ name: string; content: string }> {
  const flags = resolveTemplateFlags(vars);
  return manifest.map((entry) => ({
    name: entry.outputPath,
    content: applyVars(applyConditionals(loadTemplate(entry.templatePath), flags), vars),
  }));
}

/**
 * Load the base project templates (app-config.json + project meta files),
 * apply variable substitution, and return an array of { name, content }
 * ready to write.
 */
export function loadBaseTemplates(
  vars: Record<string, string>,
): Array<{ name: string; content: string }> {
  return loadManifest(BASE_TEMPLATE_MANIFEST, vars);
}

/**
 * Load a single feature's templates, apply variable substitution, and return
 * an array of { name, content } ready to write.
 */
export function loadFeatureTemplates(
  featureType: FeatureType,
  vars: Record<string, string>,
): Array<{ name: string; content: string }> {
  return loadManifest(FEATURE_TEMPLATE_MANIFESTS[featureType], vars);
}

// ── Named exports (loaded at import time from .tmpl files) ──
// These allow existing code / tests that import individual templates to keep working.

export const oauthServerJsTemplate = loadTemplate('src/oauth/server.js.tmpl');
export const oauthHandlerTemplate = loadTemplate('src/oauth/handler.js.tmpl');
export const tokenStoreJsTemplate = loadTemplate('src/oauth/token-store.js.tmpl');
export const envExampleTemplate = loadTemplate('src/oauth/.env.example.tmpl');
export const envLocalTemplate = loadTemplate('src/oauth/.env.local.tmpl');
export const gitignoreTemplate = loadTemplate('gitignore.tmpl');
export const packageJsonTemplate = loadTemplate('src/oauth/package.json.tmpl');
export const appConfigTemplate = loadTemplate('app-config.json.tmpl');
export const agentsMdTemplate = loadTemplate('AGENTS.md.tmpl');
export const claudeMdTemplate = loadTemplate('CLAUDE.md.tmpl');
export const readmeTemplate = loadTemplate('README.md.tmpl');
