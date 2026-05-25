import { OAUTH_SCOPES_URL } from '../lib/constants';
import { messages } from '../lang/en';
import type { ScopeEntry } from './oauth-metadata';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value: unknown): string {
  // Safe for embedding inside <script type="application/json">: only
  // </script> can end the block, so we just neutralise '<'.
  return JSON.stringify(value).replaceAll('<', String.raw`\u003c`);
}

// Styling borrows from Brevo's design system (NAOS/SIB tokens) — iris-purple
// accent and charcoal-grey neutrals. Fonts use a system stack (no CDN fetch
// or web-font download) so the page renders the same with or without network.
const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --hero-bg: #f5f5f5;
  --fg: #1b1b1b;
  --muted: #696969;
  --border: #e3e3e3;
  --accent: #6358de;
  --card: #ffffff;
  --card-shadow: 0 1px 2px rgba(28, 28, 28, .08);
  --chip-bg: #efeefc;
  --chip-fg: #3c3585;
  --section-header-bg: #fafafa;
  --error: #cf1a3b;
  --radius-card: 16px;
  --radius-input: 16px;
  --radius-chip: 20px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1224;
    --hero-bg: #181b30;
    --fg: #f1f5f9;
    --muted: #94a3b8;
    --border: #2a2f4d;
    --accent: #b3aeef;
    --card: #1a1e35;
    --card-shadow: 0 1px 2px rgba(0, 0, 0, .4);
    --chip-bg: #2a2949;
    --chip-fg: #c7d2fe;
    --section-header-bg: #161930;
    --error: #ff8d9a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.hero {
  background: var(--hero-bg);
  padding: 2.5rem 1.5rem 2rem;
}
.hero-inner { max-width: 880px; margin: 0 auto; }
h1 {
  font-size: 2rem;
  line-height: 2.5rem;
  font-weight: 600;
  margin: 0 0 .5rem;
}
.intro { color: var(--muted); margin: 0; word-break: break-word; }
main {
  max-width: 880px;
  margin: 0 auto;
  padding: 1.5rem 1.5rem 4rem;
}
.toolbar {
  display: flex;
  gap: .75rem;
  align-items: center;
  margin-bottom: 1.5rem;
}
input[type="search"] {
  flex: 1;
  padding: .55rem .9rem;
  font: inherit;
  font-size: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--card);
  color: var(--fg);
}
input[type="search"]:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
button.refresh {
  padding: .5rem 1rem;
  font: inherit;
  font-weight: 600;
  font-size: .9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--card);
  color: var(--fg);
  cursor: pointer;
  box-shadow: var(--card-shadow);
}
button.refresh:hover { background: var(--chip-bg); border-color: var(--chip-bg); }
button.refresh:disabled { opacity: .55; cursor: progress; }
.refresh-error {
  margin: -.75rem 0 1rem;
  color: var(--error);
  font-size: .85rem;
}
section {
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  margin-bottom: 1rem;
  background: var(--card);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}
section[hidden] { display: none; }
section > h2 {
  font-size: .75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--muted);
  margin: 0;
  padding: .85rem 1rem;
  background: var(--section-header-bg);
  border-bottom: 1px solid var(--border);
}
ul { list-style: none; margin: 0; padding: .5rem 0; }
li { padding: .4rem 1rem; }
li[hidden] { display: none; }
details > summary {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: .9rem;
  cursor: pointer;
  list-style: revert;
}
details[open] > summary { margin-bottom: .35rem; }
.endpoints {
  margin: .25rem 0 .25rem 1.1rem;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: .35rem;
}
.endpoints .ep {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: .78rem;
  background: var(--chip-bg);
  color: var(--chip-fg);
  padding: .15rem .55rem;
  border-radius: var(--radius-chip);
}
.endpoints .none {
  font-size: .8rem;
  color: var(--muted);
  font-style: italic;
}
.empty { color: var(--muted); padding: 2rem 0; text-align: center; }
footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-size: .8rem;
  color: var(--muted);
}
`.trim();

const SCRIPT = `
(function () {
  var dataNode = document.getElementById('scopes-data');
  var state = dataNode ? JSON.parse(dataNode.textContent || '[]') : [];

  var listEl = document.getElementById('scopes-list');
  var searchEl = document.querySelector('input[type="search"]');
  var refreshBtn = document.getElementById('refresh-btn');
  var errorEl = document.getElementById('refresh-error');
  var introCountEl = document.getElementById('scopes-count');
  var labels = JSON.parse(document.getElementById('labels').textContent);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(entries) {
    if (!entries.length) {
      listEl.innerHTML = '<p class="empty">' + escapeHtml(labels.empty) + '</p>';
      return;
    }
    var byCategory = new Map();
    entries.forEach(function (e) {
      var list = byCategory.get(e.category);
      if (list) list.push(e);
      else byCategory.set(e.category, [e]);
    });
    var html = '';
    byCategory.forEach(function (items, cat) {
      html += '<section><h2>' + escapeHtml(cat) + '</h2><ul>';
      items.forEach(function (e) {
        var endpoints = Array.isArray(e.apiEndpoints) ? e.apiEndpoints : [];
        html += '<li><details><summary>' + escapeHtml(e.name) + '</summary>';
        if (endpoints.length) {
          html += '<div class="endpoints" aria-label="' + escapeHtml(labels.endpointsLabel) + '">';
          endpoints.forEach(function (ep) {
            html += '<span class="ep">' + escapeHtml(ep) + '</span>';
          });
          html += '</div>';
        } else {
          html += '<div class="endpoints"><span class="none">' + escapeHtml(labels.noEndpoints) + '</span></div>';
        }
        html += '</details></li>';
      });
      html += '</ul></section>';
    });
    listEl.innerHTML = html;
    applyFilter();
  }

  function applyFilter() {
    var q = searchEl ? searchEl.value.toLowerCase().trim() : '';
    var sections = listEl.querySelectorAll('section');
    sections.forEach(function (section) {
      var items = section.querySelectorAll('li');
      var anyVisible = false;
      items.forEach(function (li) {
        var text = li.textContent.toLowerCase();
        var match = q === '' || text.indexOf(q) !== -1;
        li.hidden = !match;
        if (match) anyVisible = true;
      });
      section.hidden = !anyVisible;
    });
  }

  function setCount(n) {
    if (introCountEl) introCountEl.textContent = String(n);
  }

  render(state);
  setCount(state.length);

  if (searchEl) {
    searchEl.addEventListener('input', applyFilter);
  }

  if (refreshBtn) {
    var defaultLabel = refreshBtn.textContent;
    refreshBtn.addEventListener('click', function () {
      refreshBtn.disabled = true;
      refreshBtn.textContent = labels.refreshing;
      if (errorEl) errorEl.hidden = true;
      fetch('/scopes.json', { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (body) {
          var entries = Array.isArray(body && body.scopes) ? body.scopes : [];
          state = entries;
          render(state);
          setCount(state.length);
        })
        .catch(function () {
          if (errorEl) errorEl.hidden = false;
        })
        .then(function () {
          refreshBtn.disabled = false;
          refreshBtn.textContent = defaultLabel;
        });
    });
  }
})();
`.trim();

export function renderScopesHtml(entries: ScopeEntry[]): string {
  const title = escapeHtml(messages.APP_SCOPES_WEB_TITLE);
  const intro = messages.APP_SCOPES_WEB_INTRO(entries.length, OAUTH_SCOPES_URL);
  // The intro is rendered with a dynamic count span so refresh can update it
  // in place without re-rendering the source URL.
  const introWithSpan = escapeHtml(intro).replace(
    String(entries.length),
    `<span id="scopes-count">${entries.length}</span>`,
  );
  const searchPlaceholder = escapeHtml(messages.APP_SCOPES_WEB_SEARCH_PLACEHOLDER);
  const refreshLabel = escapeHtml(messages.APP_SCOPES_WEB_REFRESH);
  const refreshError = escapeHtml(messages.APP_SCOPES_WEB_REFRESH_FAILED);
  const footer = escapeHtml(messages.APP_SCOPES_WEB_FOOTER);

  const labels = {
    empty: messages.APP_SCOPES_WEB_EMPTY,
    refreshing: messages.APP_SCOPES_WEB_REFRESHING,
    endpointsLabel: messages.APP_SCOPES_WEB_ENDPOINTS_LABEL,
    noEndpoints: messages.APP_SCOPES_WEB_NO_ENDPOINTS,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="hero">
  <div class="hero-inner">
    <h1>${title}</h1>
    <p class="intro">${introWithSpan}</p>
  </div>
</header>
<main>
  <div class="toolbar">
    <input type="search" placeholder="${searchPlaceholder}" autofocus>
    <button id="refresh-btn" class="refresh" type="button">${refreshLabel}</button>
  </div>
  <p id="refresh-error" class="refresh-error" hidden>${refreshError}</p>
  <div id="scopes-list"></div>
  <footer>${footer}</footer>
</main>
<script type="application/json" id="scopes-data">${safeJson(entries)}</script>
<script type="application/json" id="labels">${safeJson(labels)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
