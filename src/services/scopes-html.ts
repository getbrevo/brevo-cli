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
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #1463ff;
  --card: #f9fafb;
  --chip: #eef2ff;
  --chip-fg: #1e3a8a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #f1f5f9;
    --muted: #94a3b8;
    --border: #1e293b;
    --accent: #60a5fa;
    --card: #111c33;
    --chip: #1e293b;
    --chip-fg: #c7d2fe;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2.5rem 1.5rem 4rem;
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
  background: var(--bg);
  color: var(--fg);
}
main { max-width: 880px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
.intro { color: var(--muted); margin: 0 0 1.5rem; word-break: break-all; }
.toolbar {
  display: flex;
  gap: .75rem;
  align-items: center;
  margin-bottom: 1.5rem;
}
input[type="search"] {
  flex: 1;
  padding: .65rem .9rem;
  font-size: 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--fg);
}
input[type="search"]:focus {
  outline: none;
  border-color: var(--accent);
}
button.refresh {
  padding: .65rem 1rem;
  font-size: .95rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--fg);
  cursor: pointer;
}
button.refresh:hover { border-color: var(--accent); }
button.refresh:disabled { opacity: .55; cursor: progress; }
.refresh-error {
  margin: -.75rem 0 1rem;
  color: #b91c1c;
  font-size: .85rem;
}
@media (prefers-color-scheme: dark) {
  .refresh-error { color: #fca5a5; }
}
section {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 1rem;
  background: var(--card);
}
section[hidden] { display: none; }
section > h2 {
  font-size: .85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--muted);
  margin: 0;
  padding: .75rem 1rem;
  border-bottom: 1px solid var(--border);
}
ul { list-style: none; margin: 0; padding: .5rem 0; }
li {
  padding: .3rem 1rem;
}
li[hidden] { display: none; }
details > summary {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: .9rem;
  cursor: pointer;
  list-style: revert;
}
details[open] > summary { margin-bottom: .35rem; }
.endpoints {
  margin: 0 0 .25rem 1.1rem;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: .25rem .35rem;
}
.endpoints .ep {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: .8rem;
  background: var(--chip);
  color: var(--chip-fg);
  padding: .1rem .45rem;
  border-radius: 4px;
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
<main>
  <h1>${title}</h1>
  <p class="intro">${introWithSpan}</p>
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
