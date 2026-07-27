import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyConditionals, applyVars, Distribution } from '../../templates';

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
