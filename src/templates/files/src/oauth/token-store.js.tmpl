// In-memory token store — replace with your database in production

let tokens = {};
let csrfState = null;

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

  clear() {
    tokens = {};
    csrfState = null;
  },
};
