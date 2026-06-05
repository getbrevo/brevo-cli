import {
  OAUTH_SCOPES_URL,
  BREVO_CLI_REFERENCE_URL,
  BREVO_OAUTH_SCOPES_DOCS_URL,
  LEGACY_ALL_SCOPE,
} from '../lib/constants';
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

// Styling matches the Brevo developers docs (developers.brevo.com) — Brevo
// green accent, pale-green hero, and charcoal-grey neutrals. Fonts use a
// system stack (no CDN fetch or web-font download) so the page renders the
// same with or without network.
const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --hero-bg: #e6f6ec;
  --fg: #1b1b1b;
  --muted: #696969;
  --border: #e3e3e3;
  --accent: #0b996e;
  --card: #ffffff;
  --card-shadow: 0 1px 2px rgba(28, 28, 28, .08);
  --chip-bg: #e1f3e8;
  --chip-fg: #00734a;
  --section-header-bg: #f6fbf8;
  --error: #cf1a3b;
  --radius-card: 16px;
  --radius-input: 16px;
  --radius-chip: 20px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1613;
    --hero-bg: #142119;
    --fg: #f1f5f2;
    --muted: #94a89c;
    --border: #25382d;
    --accent: #3ddc97;
    --card: #16241c;
    --card-shadow: 0 1px 2px rgba(0, 0, 0, .4);
    --chip-bg: #1d3327;
    --chip-fg: #a7e3c5;
    --section-header-bg: #121f18;
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
.hero-inner {
  max-width: 880px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}
.hero-copy { flex: 1 1 24rem; min-width: 0; }
h1 {
  font-size: 2rem;
  line-height: 2.5rem;
  font-weight: 600;
  margin: 0 0 .5rem;
}
.intro { color: var(--muted); margin: 0; word-break: break-word; }
a.docs-cta {
  display: inline-block;
  flex: none;
  white-space: nowrap;
  padding: .5rem 1.1rem;
  font-weight: 600;
  font-size: .9rem;
  color: #ffffff;
  background: var(--accent);
  border-radius: var(--radius-input);
  text-decoration: none;
  box-shadow: var(--card-shadow);
}
a.docs-cta:hover { opacity: .9; }
@media (prefers-color-scheme: dark) {
  a.docs-cta { color: #0e1613; }
}
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
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .55rem 1rem;
  background: var(--section-header-bg);
  border-bottom: 1px solid var(--border);
}
.section-head h2 {
  font-size: .75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--muted);
  margin: 0;
}
button.copy {
  font: inherit;
  font-size: .75rem;
  font-weight: 600;
  padding: .2rem .7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  background: var(--card);
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
}
button.copy:hover { background: var(--chip-bg); border-color: var(--chip-bg); }
button.copy:disabled { opacity: .55; cursor: default; }
.selection-bar {
  display: flex;
  gap: .75rem;
  align-items: center;
  margin-bottom: 1.5rem;
}
.selection-bar input[type="text"] {
  flex: 1;
  padding: .55rem .9rem;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: .85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--card);
  color: var(--fg);
}
.selection-bar button.copy { padding: .5rem 1rem; font-size: .9rem; }
ul { list-style: none; margin: 0; padding: .5rem 0; }
li { padding: .4rem 1rem; }
li[hidden] { display: none; }
.scope-row { display: flex; align-items: flex-start; gap: .55rem; }
.scope-row input[type="checkbox"] {
  accent-color: var(--accent);
  margin-top: .25rem;
  flex: none;
  cursor: pointer;
}
.scope-row details { flex: 1; min-width: 0; }
.badge {
  font-size: .68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--error);
  border: 1px solid currentColor;
  border-radius: var(--radius-chip);
  padding: 0 .45rem;
  margin-left: .5rem;
  vertical-align: middle;
}
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
footer a { color: var(--accent); }
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
  var selectedEl = document.getElementById('selected-scopes');
  var copySelectedBtn = document.getElementById('copy-selected');
  var labels = JSON.parse(document.getElementById('labels').textContent);

  // Selected scope names, in click order. Rendered as '"a","b"' — pastes
  // straight into app-config.json's auth.scopes array, and shells strip the
  // quotes so "brevo app update --scope" accepts the same paste.
  var selected = [];

  function quoted(names) {
    return names.map(function (n) { return '"' + n + '"'; }).join(',');
  }

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
      var copyAria = labels.copyCategoryAria.replace('{category}', cat);
      html += '<section><div class="section-head"><h2>' + escapeHtml(cat) + '</h2>';
      html +=
        '<button type="button" class="copy copy-category" data-category="' + escapeHtml(cat) +
        '" aria-label="' + escapeHtml(copyAria) + '">' + escapeHtml(labels.copy) + '</button></div><ul>';
      items.forEach(function (e) {
        var endpoints = Array.isArray(e.apiEndpoints) ? e.apiEndpoints : [];
        var isLegacy = e.name === labels.legacyScope;
        html += '<li><div class="scope-row">';
        if (isLegacy) {
          // The legacy catch-all scope is deprecated: badge it, no checkbox,
          // and copy CTAs skip it so pasted lists never reintroduce it.
          html += '<details><summary>' + escapeHtml(e.name) +
            '<span class="badge" title="' + escapeHtml(labels.legacyTitle) + '">' +
            escapeHtml(labels.legacyBadge) + '</span></summary>';
        } else {
          var selectAria = labels.selectScopeAria.replace('{scope}', e.name);
          html += '<input type="checkbox" class="scope-check" data-scope="' + escapeHtml(e.name) +
            '" aria-label="' + escapeHtml(selectAria) + '"' +
            (selected.indexOf(e.name) !== -1 ? ' checked' : '') + '>';
          html += '<details><summary>' + escapeHtml(e.name) + '</summary>';
        }
        if (endpoints.length) {
          html += '<div class="endpoints" aria-label="' + escapeHtml(labels.endpointsLabel) + '">';
          endpoints.forEach(function (ep) {
            html += '<span class="ep">' + escapeHtml(ep) + '</span>';
          });
          html += '</div>';
        } else {
          html += '<div class="endpoints"><span class="none">' + escapeHtml(labels.noEndpoints) + '</span></div>';
        }
        html += '</details></div></li>';
      });
      html += '</ul></section>';
    });
    listEl.innerHTML = html;
    applyFilter();
  }

  function copyText(text, btn) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      var original = btn.textContent;
      btn.textContent = labels.copied;
      setTimeout(function () {
        btn.textContent = original;
      }, 1200);
    }).catch(function () { /* clipboard denied — leave the button as-is */ });
  }

  function updateSelection() {
    selectedEl.value = quoted(selected);
    copySelectedBtn.disabled = selected.length === 0;
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
  updateSelection();

  if (searchEl) {
    searchEl.addEventListener('input', applyFilter);
  }

  // Delegated handlers survive re-renders (refresh replaces listEl's HTML).
  listEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button.copy-category') : null;
    if (!btn) return;
    var cat = btn.getAttribute('data-category');
    var names = state
      .filter(function (e) { return e.category === cat && e.name !== labels.legacyScope; })
      .map(function (e) { return e.name; });
    copyText(quoted(names), btn);
  });

  listEl.addEventListener('change', function (ev) {
    var box = ev.target.closest ? ev.target.closest('input.scope-check') : null;
    if (!box) return;
    var name = box.getAttribute('data-scope');
    var idx = selected.indexOf(name);
    if (box.checked && idx === -1) selected.push(name);
    if (!box.checked && idx !== -1) selected.splice(idx, 1);
    updateSelection();
  });

  copySelectedBtn.addEventListener('click', function () {
    if (selected.length) copyText(quoted(selected), copySelectedBtn);
  });

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
          // Drop selections for scopes the IdP no longer returns.
          selected = selected.filter(function (name) {
            return state.some(function (e) { return e.name === name; });
          });
          render(state);
          setCount(state.length);
          updateSelection();
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
  const docsLink = escapeHtml(messages.APP_SCOPES_WEB_DOCS_LINK);
  const catalogDocsCta = escapeHtml(messages.APP_SCOPES_WEB_CATALOG_DOCS_CTA);
  const selectedPlaceholder = escapeHtml(messages.APP_SCOPES_WEB_SELECTED_PLACEHOLDER);
  const copySelected = escapeHtml(messages.APP_SCOPES_WEB_COPY_SELECTED);

  const labels = {
    empty: messages.APP_SCOPES_WEB_EMPTY,
    refreshing: messages.APP_SCOPES_WEB_REFRESHING,
    endpointsLabel: messages.APP_SCOPES_WEB_ENDPOINTS_LABEL,
    noEndpoints: messages.APP_SCOPES_WEB_NO_ENDPOINTS,
    copy: messages.APP_SCOPES_WEB_COPY,
    copied: messages.APP_SCOPES_WEB_COPIED,
    copyCategoryAria: messages.APP_SCOPES_WEB_COPY_CATEGORY_ARIA,
    selectScopeAria: messages.APP_SCOPES_WEB_SELECT_SCOPE_ARIA,
    legacyScope: LEGACY_ALL_SCOPE,
    legacyBadge: messages.APP_SCOPES_WEB_LEGACY_BADGE,
    legacyTitle: messages.APP_SCOPES_WEB_LEGACY_TITLE,
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
    <div class="hero-copy">
      <h1>${title}</h1>
      <p class="intro">${introWithSpan}</p>
    </div>
    <a class="docs-cta" href="${BREVO_OAUTH_SCOPES_DOCS_URL}" target="_blank" rel="noopener noreferrer">${catalogDocsCta} ↗</a>
  </div>
</header>
<main>
  <div class="toolbar">
    <input type="search" placeholder="${searchPlaceholder}" autofocus>
    <button id="refresh-btn" class="refresh" type="button">${refreshLabel}</button>
  </div>
  <p id="refresh-error" class="refresh-error" hidden>${refreshError}</p>
  <div class="selection-bar">
    <input id="selected-scopes" type="text" readonly placeholder="${selectedPlaceholder}" aria-label="${selectedPlaceholder}">
    <button id="copy-selected" class="copy" type="button" disabled>${copySelected}</button>
  </div>
  <div id="scopes-list"></div>
  <footer>${footer} <a href="${BREVO_CLI_REFERENCE_URL}">${docsLink}</a></footer>
</main>
<script type="application/json" id="scopes-data">${safeJson(entries)}</script>
<script type="application/json" id="labels">${safeJson(labels)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
