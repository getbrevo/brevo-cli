import { applyVars } from '../../templates';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/files');

function loadTemplate(relativePath: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, relativePath), 'utf-8');
}

describe('oauth/handler.js template', () => {
  const vars = {
    '{{APP_NAME}}': 'Test App',
    '{{CLIENT_ID}}': '3232323232',
    '{{CLIENT_SECRET}}': 'test-secret',
    '{{REDIRECT_URI}}': 'http://localhost:23232',
    '{{OAUTH_BASE}}': 'https://oauth.brevo.com',
    '{{OAUTH_REALM}}': 'partner',
  };

  let handlerContent: string;

  beforeAll(() => {
    const raw = loadTemplate('src/oauth/handler.js.tmpl');
    handlerContent = applyVars(raw, vars);
  });

  describe('Start OAuth Flow', () => {
    it('should open auth URL for https://oauth.brevo.com/realms/partner/oauth/authorize?response_type=code&client_id=3232323232&redirect_uri=http%3A%2F%2Flocalhost%3A23232', () => {
      // OAUTH_BASE fallback is substituted to the correct realm server
      expect(handlerContent).toContain(
        "const OAUTH_BASE = process.env.OAUTH_BASE || 'https://oauth.brevo.com'",
      );
      // OAUTH_REALM fallback is substituted to 'partner'
      expect(handlerContent).toContain("const OAUTH_REALM = process.env.OAUTH_REALM || 'partner'");
      // realmPath builds the full realm-based OAuth path
      expect(handlerContent).toContain('`${OAUTH_BASE}/realms/${OAUTH_REALM}/oauth`');

      // The authorize redirect constructs the correct query parameters
      expect(handlerContent).toContain('`${realmPath}/authorize?`');
      expect(handlerContent).toContain('`response_type=code`');
      expect(handlerContent).toContain('`&client_id=${encodeURIComponent(CLIENT_ID)}`');
      expect(handlerContent).toContain('`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`');

      // REDIRECT_URI fallback is substituted
      expect(handlerContent).toContain(
        "const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:23232'",
      );
    });

    it('should read CLIENT_ID from environment at runtime', () => {
      // CLIENT_ID is read from process.env, not baked into the template
      expect(handlerContent).toContain('const CLIENT_ID = process.env.CLIENT_ID');
    });

    it('should not contain unsubstituted template variables', () => {
      expect(handlerContent).not.toContain('{{OAUTH_BASE}}');
      expect(handlerContent).not.toContain('{{OAUTH_REALM}}');
      expect(handlerContent).not.toContain('{{REDIRECT_URI}}');
    });
  });

  describe('Refresh Token', () => {
    it('should POST to the realm token endpoint with grant_type refresh_token', () => {
      expect(handlerContent).toContain('`${realmPath}/token`');
      expect(handlerContent).toContain("grant_type: 'refresh_token'");
    });

    it('should send client credentials and refresh_token in the request', () => {
      expect(handlerContent).toContain('client_id: CLIENT_ID');
      expect(handlerContent).toContain('client_secret: CLIENT_SECRET');
      expect(handlerContent).toContain('refresh_token: refreshToken');
    });

    it('should save new tokens after refresh', () => {
      expect(handlerContent).toContain(
        'tokenStore.saveTokens({ access_token, refresh_token, expires_in })',
      );
    });

    it('should return 400 when no refresh token is available', () => {
      expect(handlerContent).toContain(
        "res.status(400).send('No refresh token available. Complete /auth/login first.')",
      );
    });
  });

  describe('Post-OAuth hints', () => {
    it('should declare PORT for the refresh URL hint', () => {
      expect(handlerContent).toContain('const PORT = process.env.PORT || 3009');
    });

    it('should print the refresh URL after a successful token exchange', () => {
      expect(handlerContent).toContain('`Token refresh: http://localhost:${PORT}/auth/refresh`');
    });

    it('should print a next-steps hint after a successful token exchange', () => {
      expect(handlerContent).toContain(
        "'Next: use the access token to call the Brevo API, or open src/oauth/handler.js to see how the flow is wired.'",
      );
    });
  });
});

describe('oauth/server.js template', () => {
  let serverContent: string;

  beforeAll(() => {
    const raw = loadTemplate('src/oauth/server.js.tmpl');
    serverContent = applyVars(raw, { '{{APP_NAME}}': 'Test App' });
  });

  it('should render the Start OAuth Flow link pointing to /auth/login', () => {
    expect(serverContent).toContain('Start OAuth Flow');
    expect(serverContent).toContain('/auth/login');
  });

  it('should render the Refresh Token link pointing to /auth/refresh', () => {
    expect(serverContent).toContain('Refresh Token');
    expect(serverContent).toContain('/auth/refresh');
  });

  it('should substitute the app name', () => {
    expect(serverContent).toContain('Test App');
    expect(serverContent).not.toContain('{{APP_NAME}}');
  });
});
