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

function loadManifest(
  manifest: TemplateFile[],
  vars: Record<string, string>,
): Array<{ name: string; content: string }> {
  return manifest.map((entry) => ({
    name: entry.outputPath,
    content: applyVars(loadTemplate(entry.templatePath), vars),
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
