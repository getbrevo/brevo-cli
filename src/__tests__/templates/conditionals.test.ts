import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyConditionals, applyVars, Distribution, TemplateFlag } from '../../templates';

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/files');
function loadTemplate(relativePath: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, relativePath), 'utf-8');
}

describe('applyConditionals', () => {
  it('keeps the matching branch and strips the other branch and all markers', () => {
    const tmpl = [
      'a',
      '{{#if public}}',
      'pub',
      '{{/if}}',
      '{{#if private}}',
      'priv',
      '{{/if}}',
      'b',
    ].join('\n');
    expect(applyConditionals(tmpl, 'public')).toBe('a\npub\nb');
    expect(applyConditionals(tmpl, 'private')).toBe('a\npriv\nb');
  });

  it('is an identity transform for templates without markers', () => {
    const tmpl = 'line1\nline2\n\nline4\n';
    expect(applyConditionals(tmpl, 'public')).toBe(tmpl);
    expect(applyConditionals(tmpl, 'private')).toBe(tmpl);
  });

  it('drops a whole nested block when its parent branch is excluded', () => {
    const tmpl = [
      '{{#if public}}',
      'p1',
      '{{#if private}}',
      'never',
      '{{/if}}',
      'p2',
      '{{/if}}',
    ].join('\n');
    // Inner private block can never survive inside a public-only block.
    expect(applyConditionals(tmpl, 'public')).toBe('p1\np2');
    expect(applyConditionals(tmpl, 'private')).toBe('');
  });

  it('throws on unbalanced markers', () => {
    expect(() => applyConditionals('{{#if public}}\nx', 'public')).toThrow('unclosed');
    expect(() => applyConditionals('x\n{{/if}}', 'public')).toThrow('unmatched');
  });
});

describe('token-store.js template branching', () => {
  const VARS = {} as Record<string, string>;
  const render = (d: Distribution): string =>
    applyVars(applyConditionals(loadTemplate('src/oauth/token-store.js.tmpl'), d), VARS);

  it('private: no PKCE verifier accessors; clear() only resets tokens + state', () => {
    const priv = render('private');
    expect(priv).not.toContain('codeVerifier');
    expect(priv).not.toContain('setVerifier');
    expect(priv).not.toContain('getVerifier');
    expect(priv).toContain('clear() {\n    tokens = {};\n    csrfState = null;\n  },');
  });

  it('public: adds setVerifier/getVerifier and clears the verifier', () => {
    const pub = render('public');
    expect(pub).toContain('setVerifier(verifier) {');
    expect(pub).toContain('getVerifier() {');
    expect(pub).toContain('return codeVerifier;');
    expect(pub).toContain(
      'clear() {\n    tokens = {};\n    csrfState = null;\n    codeVerifier = null;\n  },',
    );
  });
});

describe('.env template branching', () => {
  const VARS = {
    '{{CLIENT_ID}}': 'cid',
    '{{CLIENT_SECRET}}': 'csecret',
    '{{REDIRECT_URI}}': 'http://localhost:3009/auth/callback',
    '{{OAUTH_BASE}}': 'https://oauth.brevo.com',
    '{{OAUTH_REALM}}': 'partner',
  };
  const render = (file: string, d: Distribution): string =>
    applyVars(applyConditionals(loadTemplate(file), d), VARS);

  it('private .env.local keeps CLIENT_SECRET; public omits it', () => {
    expect(render('src/oauth/.env.local.tmpl', 'private')).toContain('CLIENT_SECRET=csecret');
    expect(render('src/oauth/.env.local.tmpl', 'public')).not.toContain('CLIENT_SECRET');
  });

  it('private .env.example keeps CLIENT_SECRET; public omits it and notes PKCE', () => {
    expect(render('src/oauth/.env.example.tmpl', 'private')).toContain('CLIENT_SECRET=');
    const pub = render('src/oauth/.env.example.tmpl', 'public');
    expect(pub).not.toContain('CLIENT_SECRET');
    expect(pub).toContain('PKCE');
  });
});

// ──────────────── App-type flags (BEX-290) ────────────────
describe('app-type conditionals', () => {
  it('accepts a flag set alongside the legacy Distribution argument', () => {
    const tmpl = [
      '{{#if oauth}}',
      'oauth-only',
      '{{/if}}',
      '{{#if ui_app}}',
      'ui-only',
      '{{/if}}',
    ].join('\n');

    expect(applyConditionals(tmpl, new Set<TemplateFlag>(['private', 'oauth']))).toBe('oauth-only');
    expect(applyConditionals(tmpl, new Set<TemplateFlag>(['private', 'ui_app']))).toBe('ui-only');
    // A bare Distribution still works and matches neither app-type branch.
    expect(applyConditionals(tmpl, 'private')).toBe('');
  });

  it('combines distribution and app-type flags independently', () => {
    const tmpl = ['{{#if ui_app}}', 'ui', '{{#if public}}', 'ui-public', '{{/if}}', '{{/if}}'].join(
      '\n',
    );

    expect(applyConditionals(tmpl, new Set<TemplateFlag>(['public', 'ui_app']))).toBe(
      'ui\nui-public',
    );
    expect(applyConditionals(tmpl, new Set<TemplateFlag>(['private', 'ui_app']))).toBe('ui');
  });
});

describe('app-config.json template branching', () => {
  const BASE_VARS = {
    '{{APP_ID}}': '42',
    '{{APP_NAME}}': 'Invoice Manager',
    '{{APP_VERSION}}': '1.0.0',
    '{{LOGO_URI}}': '',
    '{{DISTRIBUTION}}': 'private',
    '{{SCOPES_JSON}}': '["contacts:read","contacts:write"]',
    '{{REDIRECT_URLS_JSON}}': '["http://localhost:3009/auth/callback"]',
  };

  const renderConfig = (extraVars: Record<string, string>, flags: Set<TemplateFlag>): string =>
    applyVars(applyConditionals(loadTemplate('app-config.json.tmpl'), flags), {
      ...BASE_VARS,
      ...extraVars,
    });

  it('renders valid JSON with redirectUris and no ui_app for an OAuth app', () => {
    const out = renderConfig(
      { '{{UI_APP_JSON}}': '' },
      new Set<TemplateFlag>(['private', 'oauth']),
    );
    const parsed = JSON.parse(out);

    expect(parsed.auth.redirectUris).toEqual(['http://localhost:3009/auth/callback']);
    expect(parsed).not.toHaveProperty('ui_app');
  });

  it('renders valid JSON with ui_app and no redirectUris for a UI app', () => {
    // The platform's app-snapshot shape — nested one level deep, which is
    // what the template's indent handling has to survive.
    const uiApp = {
      extension_type: 'actionLink',
      surface_point_list: [
        { surface_point: 'contactDetails.headerMenu.action', context: ['recordId'] },
        { surface_point: 'dealDetails.headerMenu.action', context: ['recordId', 'recordName'] },
      ],
      label: 'View in CRM',
      more_info: 'Open this contact in your connected CRM.',
      redirect_link: 'https://example.com/brevo',
    };
    const out = renderConfig(
      { '{{UI_APP_JSON}}': JSON.stringify(uiApp, null, 2).split('\n').join('\n  ') },
      new Set<TemplateFlag>(['private', 'ui_app']),
    );
    const parsed = JSON.parse(out);

    expect(parsed.ui_app).toEqual(uiApp);
    // A UI app has no OAuth block: auth is exactly the empty object.
    expect(parsed.auth).toEqual({});
  });

  // Dropped from the scaffolded config (nothing ever read them) — their
  // reappearance would mean the template regressed.
  it('renders neither permittedUrls nor support for either app type', () => {
    for (const flags of [
      new Set<TemplateFlag>(['private', 'oauth']),
      new Set<TemplateFlag>(['private', 'ui_app']),
    ]) {
      const parsed = JSON.parse(renderConfig({ '{{UI_APP_JSON}}': '{}' }, flags));
      expect(parsed).not.toHaveProperty('permittedUrls');
      expect(parsed).not.toHaveProperty('support');
    }
  });
});
