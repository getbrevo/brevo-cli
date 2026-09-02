/**
 * Build the CLI.
 *
 * esbuild rather than `tsc`. It was adopted for the pre-GA gate, which needed unreleased
 * commands *absent* from the published package rather than merely unreachable — `tsc`
 * does no dead-code elimination. **That gate is gone (BEX-405, torn down after GA), and
 * esbuild stays**: it is the build now, and reverting to `tsc` would change the published
 * layout (`dist/bin/index.js` as a single-file entry, `dist/bin/files`, `sideEffects:
 * false`) for no gain. If a feature ever has to be held back from a published build
 * again, read `CLAUDE.md` → *If you ever need to gate a feature again* first — the
 * mechanism and both of its traps are written down there.
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
  // The map ships — `package.json` `files:` publishes the whole of `dist/` — so every
  // byte of it is downloaded by every install. With `sourcesContent` on, esbuild embeds
  // the untouched TypeScript of every module, comments included, roughly tripling the
  // map for nothing: off, it still resolves a stack trace to `src/lib/foo.ts:123` (that
  // is `sources` + `mappings`, not the text), and a maintainer who wants the source
  // alongside it has the repo, which is public.
  sourcesContent: false,
  legalComments: 'none',
  // No `metafile`: nothing reads one. `logLevel: 'info'` is what prints the per-output
  // sizes this build reports, and the assertion below reads the emitted file rather than
  // esbuild's own accounting — deliberately, see the comment there.
  logLevel: 'info',
  // `minifySyntax` is what enables the dead-code elimination and tree-shaking that
  // choosing a bundler was for; `minifyWhitespace` drops the comments esbuild otherwise
  // preserves verbatim. Together they are most of the difference between the bundle and
  // a concatenation of the sources.
  //
  // `minifyIdentifiers` stays OFF: mangled names would make a user's stack trace useless
  // in bug reports, and it buys little here. It is also what keeps `GA_MARKERS` below
  // able to look for a binding by its real name.
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
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

// Bindings that must be PRESENT in the bundle. The check is deliberately on the OUTPUT,
// not on the config: a stray refactor that makes one of these modules unreachable — the
// last import moved behind a condition esbuild can fold, a definition moved into a module
// nothing live references — leaves the config looking correct while the bundle quietly
// loses the commands. That is not hypothetical; it is what the pre-GA gate did on purpose,
// twice by accident, and it is why this list is asserted against the emitted file.
//
// **Module-level bindings only, never an object property.** esbuild cannot prune a
// property from an object literal, so anything reached as `OBJECT.KEY` survives at zero
// references and would pass this check without proving anything. `minifyIdentifiers` is
// off, so a surviving module's bindings appear verbatim.
const GA_MARKERS = [
  'appInstallCommand', // commands/app/install.ts — GA at BEX-290
  'appUninstallCommand', // commands/app/uninstall.ts — GA at BEX-290
  'resolveInstallTarget', // commands/app/account-install.ts — GA at BEX-290
  'submitCommand', // commands/app/submit.ts — GA at BEX-405
  'statusCommand', // commands/app/status.ts — GA at BEX-405
  'withdrawCommand', // commands/app/withdraw.ts — GA at BEX-405
];

const bundle = fs.readFileSync(outfile, 'utf-8');

const missingGa = GA_MARKERS.filter((marker) => !bundle.includes(marker));
if (missingGa.length > 0) {
  throw new Error(
    `Shipped surface missing from the build: ${missingGa.join(', ')}.\n` +
      'A module that must ship was eliminated. Check that nothing moved its only ' +
      'reference behind a condition esbuild can fold to false, or into a module no live ' +
      'code imports.',
  );
}

const bytes = fs.statSync(outfile).size;
console.log(`build → dist/bin/index.js (${(bytes / 1024).toFixed(1)} kB)`);
