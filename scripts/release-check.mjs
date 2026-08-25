#!/usr/bin/env node
/**
 * Release gates. Two modes, one set of assertions.
 *
 *   node scripts/release-check.mjs pre
 *   node scripts/release-check.mjs post --version=2.2.0
 *
 * `pre` runs before the publish and inspects the tarball `npm pack` produces.
 * `post` runs after it and inspects the tarball the registry actually serves.
 * Both feed the SAME `assertTarball()`, which is the point: a pre-publish gate
 * that checks something other than what the registry ends up with is a gate on
 * a different artifact. The only asymmetry is registry metadata — dist-tag,
 * provenance attestation, integrity — which exists only in `post`.
 *
 * What this deliberately does NOT check: the gated public-app surface. That is
 * `scripts/build.mjs`'s job (LEAK_MARKERS / LEAK_STRINGS / GA_MARKERS), it
 * throws at build time, and `prepublishOnly` rebuilds so it runs again on the
 * publish itself. A second copy of that list here could only drift from it.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

// Paths that must be in the tarball, relative to the package root. `files:` in
// package.json is an allow-list, so a missing entry here is always a silent
// loss: the CLI publishes, installs, and then can't scaffold (templates), or
// every agent helping a user reads a skill that isn't there (agent-context).
const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'dist/bin/index.js',
  'agent-context/SKILL.md',
  'agent-context/AGENTS.md',
];

// The mirror image, and the reason this gate is worth having on a PUBLIC
// package: `files:` can only ship these by mistake, and the mistake is
// unrecoverable once the tarball is on npm. The branch-local working docs are
// the never-merge-to-main set from CLAUDE.md; the rest is credential material.
const FORBIDDEN_PATTERNS = [
  { re: /^RELEASE-CHECKLIST\.md$/, why: 'branch-local working doc' },
  { re: /^QA-TESTCASES\.md$/, why: 'branch-local working doc' },
  { re: /^docs\.md$/, why: 'branch-local working doc' },
  { re: /RELEASE-STATUS\.md$/, why: 'branch-local working doc' },
  { re: /(^|\/)\.env(\.|$)/, why: 'environment file' },
  { re: /(^|\/)credentials\.json$/, why: 'credential store' },
  { re: /(^|\/)\.brevo\.json$/, why: 'linked-project config' },
  // Not `.tmpl`: `dist/bin/files/app-config.json.tmpl` is the scaffold
  // template and must ship. A real `app-config.json` must not.
  { re: /(^|\/)app-config\.json$/, why: 'real app config' },
  { re: /(^|\/)\.npmrc$/, why: 'registry auth' },
  { re: /\.(pem|p12|key)$/, why: 'private key' },
];

// Secret shapes, scanned across every packed file. `xkeysib-test-` is the
// placeholder the repo's fixtures use, so it must not trip this.
const SECRET_PATTERNS = [
  { re: /xkeysib-(?!test-)[A-Za-z0-9]{8}/, why: 'Brevo API key' },
  { re: /xsmtpsib-(?!test-)[A-Za-z0-9]{8}/, why: 'Brevo SMTP key' },
  { re: /ghp_[A-Za-z0-9]{20}/, why: 'GitHub token' },
  { re: /npm_[A-Za-z0-9]{20}/, why: 'npm token' },
];

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const failures = [];
let checks = 0;

function check(label, fn) {
  checks += 1;
  try {
    const detail = fn();
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures.push({ label, message: error.message });
    console.log(`  ✗ ${label}`);
    console.log(`      ${error.message.split('\n').join('\n      ')}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// execFileSync's own message is just the command line; the reason is on
// stderr, which it captures and then hides. A gate that says "command failed"
// and nothing else is a gate someone re-runs locally to find out why.
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', ...opts });
  } catch (error) {
    const stderr = (error.stderr ?? '').toString().trim();
    const stdout = (error.stdout ?? '').toString().trim();
    const detail = stderr || stdout;
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Tarball assertions — shared by both modes
// ---------------------------------------------------------------------------

/**
 * Extract to a temp dir and return { dir, files } where `files` are paths
 * relative to the package root, npm's `package/` prefix stripped.
 */
function unpack(tarball) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-release-check-'));
  run('tar', ['-xzf', tarball, '-C', dir]);
  const pkgDir = path.join(dir, 'package');
  assert(fs.existsSync(pkgDir), `tarball has no package/ root: ${tarball}`);

  const files = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else files.push(path.relative(pkgDir, next));
    }
  };
  walk(pkgDir);
  return { dir: pkgDir, files };
}

function assertTarball(tarball, expectedVersion) {
  const { dir, files } = unpack(tarball);

  check('required files present', () => {
    const missing = REQUIRED_FILES.filter((f) => !files.includes(f));
    assert(missing.length === 0, `missing from the tarball: ${missing.join(', ')}`);
    return `${REQUIRED_FILES.length} checked`;
  });

  check('no forbidden files', () => {
    const hits = [];
    for (const file of files) {
      // `.tmpl` files are scaffold samples by construction — the set includes
      // `.env.example.tmpl` and `app-config.json.tmpl`, which are exactly the
      // names these patterns hunt for. They ship on purpose (and are gated by
      // the template count below); their *content* is still secret-scanned.
      if (file.endsWith('.tmpl')) continue;
      for (const { re, why } of FORBIDDEN_PATTERNS) {
        if (re.test(file)) hits.push(`${file} (${why})`);
      }
    }
    assert(hits.length === 0, `must never be published:\n${hits.join('\n')}`);
    return `${files.length - files.filter((f) => f.endsWith('.tmpl')).length} entries scanned`;
  });

  // Self-maintaining on purpose: a twelfth template needs no edit here, but a
  // template that stops being copied into dist/ fails the gate. `app scaffold`
  // is dead without these and nothing else in the release path looks at them.
  check('every scaffold template shipped', () => {
    const sourceDir = path.join(root, 'src/templates/files');
    const expected = fs
      .readdirSync(sourceDir, { recursive: true })
      .filter((f) => String(f).endsWith('.tmpl')).length;
    const shipped = files.filter((f) => f.endsWith('.tmpl')).length;
    assert(expected > 0, `no .tmpl files found in ${sourceDir}`);
    assert(shipped === expected, `src has ${expected} templates, tarball has ${shipped}`);
    return `${shipped} templates`;
  });

  check('bin entry points at a packed file', () => {
    const entries = Object.entries(pkg.bin ?? {});
    assert(entries.length > 0, 'package.json declares no bin');
    for (const [name, target] of entries) {
      const rel = target.replace(/^\.\//, '');
      assert(files.includes(rel), `bin "${name}" → ${rel} is not in the tarball`);
      const first = fs.readFileSync(path.join(dir, rel), 'utf-8').split('\n', 1)[0];
      assert(
        first.startsWith('#!'),
        `bin "${name}" → ${rel} has no shebang (got: ${first.slice(0, 40)})`,
      );
    }
    return entries.map(([n]) => n).join(', ');
  });

  check('packaged version matches', () => {
    const packed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert(
      packed.version === expectedVersion,
      `tarball package.json says ${packed.version}, expected ${expectedVersion}`,
    );
    return packed.version;
  });

  // The dependency closure, which is the one thing neither jest nor the build
  // can see: esbuild keeps `commander`/`inquirer` external (`packages:
  // 'external'` in build.mjs), so the bundle `require`s them at runtime from
  // node_modules. A dependency that drifted into devDependencies builds, tests
  // and packs perfectly, then fails on the first user's machine with
  // MODULE_NOT_FOUND. Installing the tarball into an empty tree is the only
  // way to prove the closure is complete — running the bundle in this repo
  // would resolve against the repo's own node_modules and always pass.
  check('tarball installs and the installed CLI runs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-release-install-'));
    fs.writeFileSync(
      path.join(home, 'package.json'),
      JSON.stringify({ name: 'brevo-release-check', version: '0.0.0', private: true }),
    );
    try {
      // `--cache` into the temp tree: the install must prove the tarball's own
      // dependency closure, not inherit whatever the shared cache happens to
      // hold — and it must not fail for reasons that belong to the machine
      // (a permission-broken ~/.npm is the usual one locally).
      run(
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--loglevel=error',
          `--cache=${path.join(home, '.npm-cache')}`,
          tarball,
        ],
        { cwd: home },
      );
      const bin = path.join(home, 'node_modules/.bin/brevo');
      assert(fs.existsSync(bin), 'npm did not link node_modules/.bin/brevo');
      const env = { ...process.env, BREVO_NO_SKILL_AUTOREFRESH: '1' };
      const reported = run(bin, ['--version'], { cwd: home, env }).trim();
      assert(
        reported.includes(expectedVersion),
        `\`--version\` printed "${reported}", expected ${expectedVersion}`,
      );
      const help = run(bin, ['--help'], { cwd: home, env });
      assert(help.includes('brevo'), '`--help` output does not mention `brevo`');
      return `installed, \`--version\` → ${reported}`;
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  check('no secrets in packed content', () => {
    const hits = [];
    for (const file of files) {
      if (file.endsWith('.map')) continue; // generated from the same sources
      const text = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const { re, why } of SECRET_PATTERNS) {
        if (re.test(text)) hits.push(`${file} (${why})`);
      }
    }
    assert(hits.length === 0, `secret-shaped strings found:\n${hits.join('\n')}`);
    return `${files.length} entries scanned`;
  });

  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// pre
// ---------------------------------------------------------------------------

function preflight() {
  console.log(`Pre-publish checks for ${pkg.name}@${pkg.version}\n`);

  assert(
    fs.existsSync(path.join(root, 'dist/bin/index.js')),
    'dist/bin/index.js is missing — run `yarn build` before this check.',
  );

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-release-pack-'));
  // `--ignore-scripts`: packing must not run `prepare` (husky) — this gate
  // inspects the tree as built, and lifecycle scripts are the hotspot Sonar
  // raises on a step that can see release secrets.
  const out = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dest], {
    cwd: root,
  });
  const packed = JSON.parse(out)[0];
  const tarball = path.join(dest, packed.filename);

  console.log(`  packed ${packed.filename} (${packed.entryCount} entries, ${packed.size} bytes)\n`);
  assertTarball(tarball, pkg.version);
  fs.rmSync(dest, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// post
// ---------------------------------------------------------------------------

function npmView(spec) {
  try {
    return JSON.parse(
      run('npm', ['view', spec, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  } catch {
    return null;
  }
}

function waitForRegistry(spec, attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const meta = npmView(spec);
    if (meta) return meta;
    console.log(`  … ${spec} not on the registry yet (${attempt}/${attempts}), retrying`);
    // Deliberately synchronous: this script is a gate, not a server, and the
    // sleep must block the step.
    execFileSync('sleep', [String(delayMs / 1000)]);
  }
  return null;
}

function postflight(version) {
  const spec = `${pkg.name}@${version}`;
  console.log(`Post-publish checks for ${spec}\n`);

  const meta = waitForRegistry(spec, 30, 10_000);
  assert(meta, `${spec} never appeared on the registry (waited 5 minutes).`);

  check('registry serves the published version', () => {
    assert(meta.version === version, `registry answered ${meta.version} for ${spec}`);
    return meta.version;
  });

  check('`latest` dist-tag points at it', () => {
    const tags = npmView(`${pkg.name}`)?.['dist-tags'] ?? {};
    assert(tags.latest === version, `dist-tags.latest is ${tags.latest}, expected ${version}`);
    return `latest → ${tags.latest}`;
  });

  // The whole OIDC posture in one assertion: a token publish produces neither a
  // provenance attestation nor this publisher identity. If this fails, do not
  // paper it over with an NPM_TOKEN — fix the trusted publisher on npmjs.com.
  check('provenance attestation attached', () => {
    const predicate = meta.dist?.attestations?.provenance?.predicateType;
    assert(predicate, 'no dist.attestations.provenance on the published version');
    assert(
      predicate === 'https://slsa.dev/provenance/v1',
      `unexpected provenance predicate: ${predicate}`,
    );
    return predicate;
  });

  check('published by GitHub Actions via OIDC', () => {
    // `npm view` flattens this to a `Name <email>` string; the raw packument
    // carries `{name, email}`. Accept either so an npm-CLI change can't turn
    // this gate into a false failure.
    const raw = meta._npmUser;
    const publisher = typeof raw === 'string' ? raw : `${raw?.name} <${raw?.email}>`;
    assert(
      publisher.includes('npm-oidc-no-reply'),
      `publisher is "${publisher}" — expected the OIDC identity. A token publish looks ` +
        'like this; fix the trusted publisher on npmjs.com rather than adding an NPM_TOKEN.',
    );
    return publisher;
  });

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-release-fetch-'));
  const tarball = path.join(dest, path.basename(meta.dist.tarball));
  run('curl', ['-fsSL', '-o', tarball, meta.dist.tarball]);

  check('downloaded tarball matches the advertised integrity', () => {
    const digest = crypto.createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
    const advertised = meta.dist.integrity;
    assert(
      advertised === `sha512-${digest}`,
      `integrity mismatch\n  registry: ${advertised}\n  download: sha512-${digest}`,
    );
    return advertised.slice(0, 24) + '…';
  });

  console.log('');
  assertTarball(tarball, version);
  fs.rmSync(dest, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const [mode, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

if (mode === 'pre') {
  preflight();
} else if (mode === 'post') {
  // Accepts a bare version or a changesets release tag (`@getbrevo/cli@2.2.0`);
  // `##*@` on the tag is how release.yaml already derives the version.
  const raw = flag('version') ?? flag('tag');
  assert(raw, 'post mode needs --version=<x.y.z> (or --tag=@scope/name@x.y.z)');
  postflight(raw.slice(raw.lastIndexOf('@') + 1));
} else {
  console.error('usage: release-check.mjs pre | post --version=<x.y.z>');
  process.exit(2);
}

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.error(`  - ${f.label}: ${f.message.split('\n')[0]}`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
