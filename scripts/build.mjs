/**
 * Build the CLI (BEX-405).
 *
 * esbuild rather than `tsc` for one reason: the pre-GA command surface has to be
 * *absent* from the published package, not merely unreachable. `tsc` does no dead-code
 * elimination, so a `if (PREVIEW_BUILD)` guard would still emit every gated command
 * into `dist/`. esbuild folds the flag to a literal, drops the dead branch, and then
 * tree-shakes the handler modules that only the dead branch referenced.
 *
 * `PREVIEW=1` opts into a full-surface build for local testing (`PREVIEW=1 yarn
 * link:dev`). The default is a gated build, so `prepublishOnly` cannot accidentally
 * publish the preview surface — the safe value is the one you get by not thinking
 * about it.
 *
 * ## Two things here are load-bearing and easy to break
 *
 * **The bundle stays at `dist/bin/index.js`.** Three modules resolve paths from
 * `__dirname` at runtime, and this location is what keeps two of them correct without
 * a source change: `bin/index.ts` and `lib/cli-version.ts` read
 * `../../package.json`, and `skills/index.ts` reads `../../agent-context` — all of
 * which land on the package root from `dist/bin/`, exactly as they did when `tsc`
 * emitted them to `dist/bin/` and `dist/lib/`. Moving the bundle up to `dist/` would
 * silently resolve them one directory too high.
 *
 * **Templates are copied to `dist/bin/files`, not `dist/templates/files`.** Bundling
 * collapses every module's `__dirname` to the bundle's own directory, so
 * `templates/index.ts`'s `path.resolve(__dirname, 'files')` now means
 * `dist/bin/files`. Copying there keeps that line correct in both worlds: under jest
 * it still resolves to `src/templates/files`, because nothing is bundled there.
 *
 * Dependencies stay external (`packages: 'external'`). Bundling `commander` and
 * `inquirer` would buy nothing — the elimination we need is of our own modules — and
 * inquirer's dynamic requires do not survive bundling cleanly.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = process.env.PREVIEW === '1' || process.env.PREVIEW === 'true';
const outfile = path.join(root, 'dist/bin/index.js');

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/bin/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  // The map ships — `package.json` `files:` publishes the whole of `dist/` — so its
  // contents are as public as the bundle's. With `sourcesContent` on, esbuild embeds the
  // untouched TypeScript of every surviving module, comments included, which quietly
  // undid the scrubbing `minifyWhitespace` performs below: `brevo app submit` was gone
  // from `index.js` and one grep away in `index.js.map`. Off, the map still resolves a
  // stack trace to `src/lib/foo.ts:123` (that is `sources` + `mappings`, not the text);
  // a maintainer who wants the source alongside it has the repo, which is public.
  sourcesContent: false,
  legalComments: 'none',
  // No `metafile`: nothing reads one. `logLevel: 'info'` is what prints the per-output
  // sizes this build reports, and the gate's assertions below read the emitted file
  // rather than esbuild's own accounting — deliberately, see the comment there.
  logLevel: 'info',
  // `minifySyntax` is what actually performs the elimination: without it esbuild
  // substitutes the define but leaves `...false ? previewAppCommands : []` standing,
  // which is still a live reference and keeps every gated module in the bundle.
  // Folding the ternary is what makes the branch unreachable and the modules
  // droppable.
  //
  // `minifyWhitespace` is not cosmetic either — esbuild preserves comments in
  // unminified output, and the comments around the gated code name the commands they
  // guard. Stripping them keeps the public bundle free of the surface in prose as well
  // as in code.
  //
  // `minifyIdentifiers` stays OFF: mangled names would make a user's stack trace
  // useless in bug reports, and it buys nothing here. The sourcemap covers the rest.
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  // Substituted before parsing, at every use site. A bare global rather than the
  // exported `PREVIEW_BUILD` constant because esbuild folds a constant only inside its
  // declaring module — an importer would still emit a runtime ternary and keep the
  // dead branch's imports alive. See src/globals.d.ts.
  define: {
    __BREVO_PREVIEW__: preview ? 'true' : 'false',
  },
});

fs.cpSync(path.join(root, 'src/templates/files'), path.join(root, 'dist/bin/files'), {
  recursive: true,
});

// Make the bundle executable — it carries a `#!/usr/bin/env node` shebang, is the
// `bin` target, and is run directly through `yarn link:dev`.
//
// This is `chmod a+x`, not `chmod 755`: execute is added only where read is *already*
// granted, by shifting the read bits (0o444) down two positions into the execute
// positions (0o111). Under the usual umask 022 esbuild writes 0644, so this lands on
// 0755 exactly as the hard-coded literal did — but a maintainer building under a
// stricter umask (say 077 → 0600) now gets 0700 instead of having 0755 forced on them,
// which is what writing the literal did. Nothing downstream depends on the wider bits
// at build time: npm sets its own mode on `bin` targets when the package is installed.
const builtMode = fs.statSync(outfile).mode;
fs.chmodSync(outfile, builtMode | ((builtMode & 0o444) >> 2));

// Fail the build rather than publish a gated package that still carries the surface.
// The check is deliberately on the OUTPUT, not on the config: a define typo, a stray
// static import, or a future refactor that makes a gated module reachable would all
// leave the config looking correct while the bundle quietly regained the commands.
// Markers are top-level bindings that exist ONLY inside gated modules, so finding one
// means that module survived. `minifyIdentifiers` is off, so these names appear
// verbatim if the module does.
//
// WHAT THIS CANNOT CATCH, and why it is not a bug in the list: esbuild cannot prune
// individual properties from an object literal, so anything reached as `OBJECT.KEY`
// survives at zero references. One such object still carries a gated name in a public
// build — the `withdrawApp` method on the `appService` literal (`services/app.ts`). It
// is inert: no command reaches it and no help lists it. (`CLI.APP_INSTALL`/
// `APP_UNINSTALL`, the `/installs` endpoint and the `installApp`/`uninstallApp` methods
// used to be residue too; they became live surface at UI-apps GA.)
//
// `lang/en.ts` had the same problem and was fixed by moving the gated strings into
// `lang/preview-messages.ts` and spreading that in behind the build flag. `CLI` and
// `ENDPOINTS` carried the same residue — `brevo app submit --app-id <id>`, `brevo app
// withdraw --app-id <id>`, `brevo app status` and the `/withdraw` and `/state` paths
// were all readable via `strings` on the published binary — and have now had the same
// treatment (`lib/preview-constants.ts`), which is why `previewCli` and
// `previewEndpoints` are markers below. `appService` is the remaining case; the same
// treatment would work for it if the residue ever matters. Tracked in the GA runbook
// (`RELEASE-CHECKLIST.md` on `feature_set-brevo-cli-v2`; see CLAUDE.md → Working docs
// for why it is branch-local).
//
// So: a marker here must name a MODULE-level binding, never an object property, or the
// check fails in a way no amount of correct gating can clear. The one property-level case
// that is NOT inert — a live reader left holding a key whose definition was eliminated —
// is caught by `orphanedPreviewMessageKeys` below, which works the opposite way round:
// it asserts on names that must be ABSENT from a public build's surviving code.
const LEAK_MARKERS = [
  'previewAppCommands', // commands/preview-definitions.ts
  'submitCommand', // commands/app/submit.ts
  'statusCommand', // commands/app/status.ts
  'withdrawCommand', // commands/app/withdraw.ts
  'previewCli', // lib/preview-constants.ts — the gated `brevo app …` command strings
  'previewEndpoints', // lib/preview-constants.ts — the gated `/withdraw` + `/state` paths
];

// What a reader actually sees. LEAK_MARKERS names bindings, which is the right check for
// "did a gated module survive" but says nothing about what `strings dist/bin/index.js`
// prints — and the published tarball is public, so the command names themselves are the
// leak that matters. These stayed readable long after the modules were correctly
// eliminated, because they arrived as properties of `CLI` (see the note above); they are
// checkable only now that `lib/preview-constants.ts` makes them genuinely absent.
//
// Substrings, matched verbatim against the bundle. Keep them specific enough not to
// collide with GA copy: `brevo app status` must not match `brevo app start`, and a bare
// path fragment like `/withdraw` would false-positive on unrelated text.
const LEAK_STRINGS = ['brevo app submit', 'brevo app withdraw', 'brevo app status'];

// Every file the tarball carries, because that is the scope this particular check has
// always claimed: not "what did the bundler emit" but "what can someone read in an
// installed copy". `dist/` ships whole, so the sourcemap and the scaffold templates are
// published artifacts exactly as `index.js` is. Scanning only the bundle is what let the
// map carry the surface the bundle had been cleared of; `sourcesContent: false` removes
// that text, and reading the directory rather than one path is what stops the next file
// we add to `dist/` from repeating it.
//
// `LEAK_MARKERS` deliberately stays on the bundle alone: it asks whether a gated MODULE
// survived elimination, which is a fact about the bundle and answerable only there.
function publishedFiles() {
  const dist = path.join(root, 'dist');
  return fs
    .readdirSync(dist, { recursive: true, encoding: 'utf-8' })
    .map((entry) => path.join(dist, entry))
    .filter((file) => fs.statSync(file).isFile());
}

// The mirror image of LEAK_MARKERS, for surface that went GA: bindings that must be
// PRESENT in every build. Without this, only the jest gate suite notices a refactor
// that re-routes an install import behind `__BREVO_PREVIEW__` (or back into
// `preview-definitions.ts`) — the build would silently publish a package with no
// `brevo app install`, against this file's own philosophy of checking the output.
// Same rule as above: module-level bindings only, never object properties.
const GA_MARKERS = [
  'appInstallCommand', // commands/app/install.ts — GA at BEX-290
  'appUninstallCommand', // commands/app/uninstall.ts — GA at BEX-290
  'resolveInstallTarget', // commands/app/account-install.ts — GA at BEX-290
];

// The INVERSE leak, and the one `LEAK_MARKERS` is structurally blind to: not a gated
// module surviving, but surviving code reading a gated *string*. `messages` spreads
// `previewMessages` in behind `__BREVO_PREVIEW__`, so on a public build the definition is
// gone while `messages.SOME_KEY` at a live call site remains — and reads as `undefined`.
// The failure is silent and awful: `new CliError(undefined)` has `message === ''`, so the
// command exits 1 having printed a bare `✗` with no text. That shipped once, for
// `LEGACY_ALL_SCOPE_DEPRECATED_BLOCK` — a GA string parked in the gated module by BEX-405
// and read by `app upload`, which is in every build.
//
// Checked against the key names in the SOURCE rather than a hand-kept list, so the guard
// covers keys added to `preview-messages.ts` later without anyone remembering this file.
// `minifyIdentifiers` is off and property reads keep their names, so a surviving
// `messages.KEY` appears verbatim; the definition cannot, because the module is dropped.
// A hit therefore means exactly one thing: a live reader with no definition.
function orphanedPreviewMessageKeys(bundle) {
  const source = fs.readFileSync(path.join(root, 'src/lang/preview-messages.ts'), 'utf-8');
  const keys = [...source.matchAll(/^ {2}([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1]);
  return keys.filter((key) => bundle.includes(key));
}

const bundle = fs.readFileSync(outfile, 'utf-8');

// GA surface must survive in BOTH builds — a preview build is a superset, never a
// replacement.
const missingGa = GA_MARKERS.filter((marker) => !bundle.includes(marker));
if (missingGa.length > 0) {
  throw new Error(
    `GA surface missing from the ${preview ? 'preview' : 'public'} build: ${missingGa.join(', ')}.\n` +
      'A shipped module was eliminated. Check that nothing moved its only reference ' +
      'behind `__BREVO_PREVIEW__` or into `commands/preview-definitions.ts`.',
  );
}

if (!preview) {
  const leaked = LEAK_MARKERS.filter((marker) => bundle.includes(marker));
  if (leaked.length > 0) {
    throw new Error(
      `Gated surface leaked into a public build: ${leaked.join(', ')}.\n` +
        'A gated module is reachable from live code. Check that it is referenced only ' +
        'from behind `__BREVO_PREVIEW__` (not the imported PREVIEW_BUILD constant, which ' +
        'esbuild cannot fold across modules) and that nothing else imports it.',
    );
  }
  const leakedStrings = publishedFiles().flatMap((file) => {
    const content = fs.readFileSync(file, 'utf-8');
    return LEAK_STRINGS.filter((s) => content.includes(s)).map(
      (s) => `${s} (${path.relative(root, file)})`,
    );
  });
  if (leakedStrings.length > 0) {
    throw new Error(
      `Gated command strings are readable in a public build: ${leakedStrings.join(', ')}.\n` +
        'No command is registered for them, but `strings` on the published files names ' +
        'an unreleased feature. Move the string into `lib/preview-constants.ts` (or ' +
        '`lang/preview-messages.ts` if it is user-facing copy) so the object carrying it ' +
        'is eliminated, rather than deleting the check.',
    );
  }
  const orphaned = orphanedPreviewMessageKeys(bundle);
  if (orphaned.length > 0) {
    throw new Error(
      `Public build reads gated message keys that have no definition: ${orphaned.join(', ')}.\n` +
        'These resolve to `undefined` at runtime — a CliError built from one prints an ' +
        'empty message. Move the string to `lang/en.ts` if its feature is GA, or move the ' +
        'code that reads it behind `__BREVO_PREVIEW__`.',
    );
  }
} else {
  // Inverted on a preview build: a marker going missing here means the elimination is
  // firing when it shouldn't, which would silently ship a preview build with no preview
  // surface — the failure that looks like everything working.
  const missing = [
    ...LEAK_MARKERS.filter((marker) => !bundle.includes(marker)),
    ...LEAK_STRINGS.filter((s) => !bundle.includes(s)),
  ];
  if (missing.length > 0) {
    throw new Error(
      `Preview build is missing gated surface: ${missing.join(', ')}.\n` +
        'PREVIEW=1 should include every gated module.',
    );
  }
}

const bytes = fs.statSync(outfile).size;
console.log(
  `${preview ? 'preview' : 'public'} build → dist/bin/index.js (${(bytes / 1024).toFixed(1)} kB)`,
);
