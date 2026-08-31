#!/usr/bin/env node
/**
 * Release gates.
 *
 *   node scripts/release-check.mjs pre                     # the tarball npm pack produces
 *   node scripts/release-check.mjs post --version=2.2.0    # the one the registry serves
 *
 * Both feed the same `assertTarball()`: a pre-publish gate on a different
 * artifact than the post-publish one isn't a gate on the release.
 *
 * The gated public-app surface is NOT checked here — build.mjs owns that
 * (LEAK_MARKERS / GA_MARKERS) and `prepublishOnly` reruns it on the publish.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

// `files:` is an allow-list, so anything dropped from it publishes silently.
const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'dist/bin/index.js',
  'agent-context/SKILL.md',
  'agent-context/AGENTS.md',
];

// Unrecoverable once on npm. The docs are CLAUDE.md's never-merge-to-main set.
const FORBIDDEN_PATTERNS = [
  { re: /^RELEASE-CHECKLIST\.md$/, why: 'branch-local working doc' },
  { re: /^QA-TESTCASES\.md$/, why: 'branch-local working doc' },
  { re: /^docs\.md$/, why: 'branch-local working doc' },
  { re: /RELEASE-STATUS\.md$/, why: 'branch-local working doc' },
  { re: /(^|\/)\.env(\.|$)/, why: 'environment file' },
  { re: /(^|\/)credentials\.json$/, why: 'credential store' },
  { re: /(^|\/)\.brevo\.json$/, why: 'linked-project config' },
  { re: /(^|\/)app-config\.json$/, why: 'real app config' },
  { re: /(^|\/)\.npmrc$/, why: 'registry auth' },
  { re: /\.(pem|p12|key)$/, why: 'private key' },
];

// The `test-` lookaheads keep the repo's own `xkeysib-test-…` fixtures passing.
const SECRET_PATTERNS = [
  { re: /xkeysib-(?!test-)[A-Za-z0-9]{8}/, why: 'Brevo API key' },
  { re: /xsmtpsib-(?!test-)[A-Za-z0-9]{8}/, why: 'Brevo SMTP key' },
  { re: /ghp_[A-Za-z0-9]{20}/, why: 'GitHub token' },
  { re: /npm_[A-Za-z0-9]{20}/, why: 'npm token' },
];

const failures = [];
let checks = 0;

function check(label, fn) {
  checks += 1;
  try {
    const detail = fn();
    const suffix = detail ? ` — ${detail}` : '';
    console.log(`  ✓ ${label}${suffix}`);
  } catch (error) {
    failures.push({ label, message: error.message });
    const indented = error.message.replaceAll('\n', '\n      ');
    console.log(`  ✗ ${label}`);
    console.log(`      ${indented}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// execFileSync captures stderr and then hides it, leaving only the command line.
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', ...opts });
  } catch (error) {
    const stderr = (error.stderr ?? '').toString().trim();
    const stdout = (error.stdout ?? '').toString().trim();
    const detail = stderr || stdout;
    const reason = detail ? `:\n${detail}` : '';
    throw new Error(`${cmd} ${args.join(' ')} failed${reason}`);
  }
}

// `files` come back relative to the package root, npm's `package/` prefix stripped.
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
      // Scaffold templates include `.env.example.tmpl` and `app-config.json.tmpl` —
      // the exact names these patterns hunt for. Content is still secret-scanned.
      if (file.endsWith('.tmpl')) continue;
      for (const { re, why } of FORBIDDEN_PATTERNS) {
        if (re.test(file)) hits.push(`${file} (${why})`);
      }
    }
    assert(hits.length === 0, `must never be published:\n${hits.join('\n')}`);
    return `${files.length - files.filter((f) => f.endsWith('.tmpl')).length} entries scanned`;
  });

  // Counted against the source dir, so a twelfth template needs no edit here.
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

  // The only check on the dependency closure. Deps stay external (build.mjs
  // `packages: 'external'`), so one that drifted into devDependencies packs fine
  // and dies on the first install. Running the bundle here would resolve against
  // this repo's node_modules and always pass — hence a real install.
  check('tarball installs and the installed CLI runs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-release-install-'));
    fs.writeFileSync(
      path.join(home, 'package.json'),
      JSON.stringify({ name: 'brevo-release-check', version: '0.0.0', private: true }),
    );
    try {
      // `--cache` into the temp tree: don't inherit the shared cache, and don't
      // fail for reasons that belong to the machine (a broken ~/.npm, locally).
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

function preflight() {
  console.log(`Pre-publish checks for ${pkg.name}@${pkg.version}\n`);

  assert(
    fs.existsSync(path.join(root, 'dist/bin/index.js')),
    'dist/bin/index.js is missing — run `yarn build` before this check.',
  );

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'brevo-release-pack-'));
  // `--ignore-scripts`: inspect the tree as built, and run no lifecycle script on
  // a step that can see release secrets.
  const out = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dest], {
    cwd: root,
  });
  const packed = JSON.parse(out)[0];
  const tarball = path.join(dest, packed.filename);

  console.log(`  packed ${packed.filename} (${packed.entryCount} entries, ${packed.size} bytes)\n`);
  assertTarball(tarball, pkg.version);
  fs.rmSync(dest, { recursive: true, force: true });
}

function npmView(spec) {
  try {
    return JSON.parse(
      run('npm', ['view', spec, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  } catch {
    return null;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRegistry(spec, attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const meta = npmView(spec);
    if (meta) return meta;
    console.log(`  … ${spec} not on the registry yet (${attempt}/${attempts}), retrying`);
    await wait(delayMs);
  }
  return null;
}

async function postflight(version) {
  const spec = `${pkg.name}@${version}`;
  console.log(`Post-publish checks for ${spec}\n`);

  const meta = await waitForRegistry(spec, 30, 10_000);
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
    // `npm view` flattens this to `Name <email>`; the raw packument keeps an object.
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
  // `--proto`/`--proto-redir`: the URL comes from registry metadata, so pin the
  // scheme rather than letting `-L` follow a redirect down to http.
  run('curl', [
    '-fsSL',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '-o',
    tarball,
    meta.dist.tarball,
  ]);

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

const [mode, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

if (mode === 'pre') {
  preflight();
} else if (mode === 'post') {
  const raw = flag('version') ?? flag('tag');
  assert(raw, 'post mode needs --version=<x.y.z> (or --tag=@scope/name@x.y.z)');
  await postflight(raw.slice(raw.lastIndexOf('@') + 1));
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
