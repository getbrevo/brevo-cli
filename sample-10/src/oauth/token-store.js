// In-memory token store — replace with your database in production

let tokens = {};
let csrfState = null;
let codeVerifier = null;

module.exports = {
  saveTokens({ access_token, refresh_token, expires_in }) {
    tokens = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
    };
  },

  getAccessToken() {
    return tokens.accessToken;
  },

  getRefreshToken() {
    return tokens.refreshToken;
  },

  isExpired() {
    return !tokens.expiresAt || Date.now() >= tokens.expiresAt;
  },

  setState(state) {
    csrfState = state;
  },

  getState() {
    return csrfState;
  },

  // PKCE (RFC 7636): stash the code_verifier between /auth/login and
  // /auth/callback. Same process-local, non-session-isolated limitation as the
  // token store above — replace with your database in production.
  setVerifier(verifier) {
    codeVerifier = verifier;
  },

  getVerifier() {
    return codeVerifier;
  },

  clear() {
    tokens = {};
    csrfState = null;
    codeVerifier = null;
  },
};
