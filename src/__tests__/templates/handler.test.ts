import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyVars, applyConditionals, Distribution } from '../../templates';

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/files');

function loadTemplate(relativePath: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, relativePath), 'utf-8');
}

const VARS = {
  '{{APP_NAME}}': 'Test App',
  '{{CLIENT_ID}}': '3232323232',
  '{{CLIENT_SECRET}}': 'test-secret',
  '{{REDIRECT_URI}}': 'http://localhost:23232',
  '{{OAUTH_BASE}}': 'https://oauth.brevo.com',
  '{{OAUTH_REALM}}': 'partner',
};

// Render a template exactly the way the scaffold loader does: strip the
// distribution-conditional blocks first, then substitute `{{VAR}}` values.
function render(relativePath: string, distribution: Distribution): string {
  return applyVars(applyConditionals(loadTemplate(relativePath), distribution), VARS);
}

describe('oauth/handler.js template — shared behavior (both distributions)', () => {
  for (const distribution of ['private', 'public'] as const) {
    describe(`distribution: ${distribution}`, () => {
      let handler: string;
      beforeAll(() => {
        handler = render('src/oauth/handler.js.tmpl', distribution);
      });

      it('substitutes the OAuth server, realm and redirect fallbacks', () => {
        expect(handler).toContain(
          "const OAUTH_BASE = process.env.OAUTH_BASE || 'https://oauth.brevo.com'",
        );
        expect(handler).toContain("const OAUTH_REALM = process.env.OAUTH_REALM || 'partner'");
        expect(handler).toContain('`${OAUTH_BASE}/realms/${OAUTH_REALM}/oauth`');
        expect(handler).toContain(
          "const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:23232'",
        );
      });

      it('reads CLIENT_ID from the environment at runtime', () => {
        expect(handler).toContain('const CLIENT_ID = process.env.CLIENT_ID');
      });

      it('builds the authorize URL through the shared buildAuthorizeUrl helper', () => {
        expect(handler).toContain('function buildAuthorizeUrl(');
        expect(handler).toContain('`${realmPath}/authorize?`');
        expect(handler).toContain('`response_type=code`');
        expect(handler).toContain('`&client_id=${encodeURIComponent(CLIENT_ID)}`');
        expect(handler).toContain('`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`');
        // Exported so server.js renders the identical URL.
        expect(handler).toContain('module.exports.buildAuthorizeUrl = buildAuthorizeUrl');
      });

      it('leaves no unresolved template placeholders or conditional markers', () => {
        expect(handler).not.toContain('{{');
        expect(handler).not.toContain('}}');
      });

      it('always exchanges the auth code and refresh token at the realm token endpoint', () => {
        expect(handler).toContain('`${realmPath}/token`');
        expect(handler).toContain("grant_type: 'authorization_code'");
        expect(handler).toContain("grant_type: 'refresh_token'");
        expect(handler).toContain('client_id: CLIENT_ID');
      });
    });
  }
});

describe('oauth/handler.js template — private (confidential client)', () => {
  let handler: string;
  beforeAll(() => {
    handler = render('src/oauth/handler.js.tmpl', 'private');
  });

  it('declares CLIENT_SECRET from the environment', () => {
    expect(handler).toContain('const CLIENT_SECRET = process.env.CLIENT_SECRET');
  });

  it('authenticates the code exchange and refresh with client_secret', () => {
    // Two URLSearchParams bodies (callback + refresh) both carry the secret.
    const matches = handler.match(/client_secret: CLIENT_SECRET,/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it('contains no PKCE machinery', () => {
    expect(handler).not.toContain('code_challenge');
    expect(handler).not.toContain('code_verifier');
    expect(handler).not.toContain('setVerifier');
    expect(handler).not.toContain('getVerifier');
  });
});

describe('oauth/handler.js template — public (PKCE, no secret)', () => {
  let handler: string;
  beforeAll(() => {
    handler = render('src/oauth/handler.js.tmpl', 'public');
  });

  it('never declares or sends a client secret', () => {
    expect(handler).not.toContain('const CLIENT_SECRET');
    expect(handler).not.toContain('client_secret: CLIENT_SECRET');
    expect(handler).not.toContain('process.env.CLIENT_SECRET');
  });

  it('generates a high-entropy verifier and derives an S256 challenge with node:crypto', () => {
    expect(handler).toContain("crypto.randomBytes(32).toString('base64url')");
    expect(handler).toContain(
      "crypto.createHash('sha256').update(codeVerifier).digest('base64url')",
    );
    // No Math.random anywhere (Sonar hotspot rule).
    expect(handler).not.toContain('Math.random');
    // Stashes the verifier for the callback leg.
    expect(handler).toContain('tokenStore.setVerifier(codeVerifier)');
  });

  it('sends the S256 challenge on the authorize request and never the plain method', () => {
    expect(handler).toContain('&code_challenge=${codeChallenge}&code_challenge_method=S256');
    expect(handler).not.toContain('code_challenge_method=plain');
  });

  it('sends the code_verifier (not a secret) on the token exchange', () => {
    expect(handler).toContain('code_verifier: tokenStore.getVerifier()');
  });

  it('the derivation the template performs matches the RFC 7636 Appendix B vector', () => {
    // The template computes: base64url(sha256(verifier)). Reproduce it here to
    // pin the exact algorithm against the spec's known-answer test.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('oauth/server.js template', () => {
  for (const distribution of ['private', 'public'] as const) {
    describe(`distribution: ${distribution}`, () => {
      let server: string;
      beforeAll(() => {
        server = render('src/oauth/server.js.tmpl', distribution);
      });

      it('renders the Start OAuth Flow and Refresh Token links', () => {
        expect(server).toContain('Start OAuth Flow');
        expect(server).toContain('/auth/login');
        expect(server).toContain('Refresh Token');
        expect(server).toContain('/auth/refresh');
      });

      it('substitutes the app name and leaves no placeholders or conditional markers', () => {
        expect(server).toContain('Test App');
        expect(server).not.toContain('{{APP_NAME}}');
        // The `startsWith('{{')` runtime guards are legitimate; only the
        // template's own directives must be gone.
        expect(server).not.toContain('{{#if');
        expect(server).not.toContain('{{/if}}');
      });

      it('builds the displayed authorize URL via the shared helper (no duplicated string)', () => {
        expect(server).toContain('const { buildAuthorizeUrl } = authRouter');
        expect(server).toContain('buildAuthorizeUrl({ state:');
        // The old hand-concatenated `/oauth/authorize?response_type=code` copy is gone.
        expect(server).not.toContain('/oauth/authorize`');
      });
    });
  }

  it('private: guards on CLIENT_SECRET; public: only CLIENT_ID', () => {
    const priv = render('src/oauth/server.js.tmpl', 'private');
    const pub = render('src/oauth/server.js.tmpl', 'public');
    expect(priv).toContain('!process.env.CLIENT_SECRET');
    expect(pub).not.toContain('CLIENT_SECRET');
    expect(pub).toContain('if (!process.env.CLIENT_ID) {');
  });

  it('public: the displayed URL carries the S256 challenge parameter', () => {
    const pub = render('src/oauth/server.js.tmpl', 'public');
    expect(pub).toContain('codeChallenge:');
  });
});
