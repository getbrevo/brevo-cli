import { renderScopesHtml } from '../../services/scopes-html';

const DATA_BLOCK_RE = /<script type="application\/json" id="scopes-data">([\s\S]*?)<\/script>/;

function extractDataPayload(html: string): unknown {
  const match = DATA_BLOCK_RE.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(String(match![1]));
}

describe('renderScopesHtml', () => {
  it('embeds entries (with api endpoints) as JSON for client-side render', () => {
    const html = renderScopesHtml([
      {
        name: 'contacts:read',
        category: 'data_crm',
        apiEndpoints: ['/contacts', '/contacts/lists'],
      },
      { name: 'crm:write', category: 'data_crm', apiEndpoints: [] },
      { name: 'account:read', category: 'account', apiEndpoints: ['/account'] },
    ]);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Brevo OAuth scopes');

    expect(extractDataPayload(html)).toEqual([
      {
        name: 'contacts:read',
        category: 'data_crm',
        apiEndpoints: ['/contacts', '/contacts/lists'],
      },
      { name: 'crm:write', category: 'data_crm', apiEndpoints: [] },
      { name: 'account:read', category: 'account', apiEndpoints: ['/account'] },
    ]);
  });

  it('renders a refresh button, mount node, and wires /scopes.json', () => {
    const html = renderScopesHtml([{ name: 'a', category: 'x', apiEndpoints: [] }]);

    expect(html).toContain('id="refresh-btn"');
    expect(html).toContain('id="scopes-list"');
    expect(html).toContain('Refresh');
    expect(html).toContain("fetch('/scopes.json'");
  });

  it('neutralises </script> inside the JSON payload (XSS guard)', () => {
    const html = renderScopesHtml([
      { name: '</script><b>x</b>', category: 'a', apiEndpoints: ['</script>'] },
    ]);

    const match = DATA_BLOCK_RE.exec(html);
    expect(match).not.toBeNull();
    expect(String(match![1])).not.toContain('</script>');
    expect(String(match![1])).toContain(String.raw`\u003c/script>`);
  });

  it('exposes self-contained assets (1 style block, no external links)', () => {
    const html = renderScopesHtml([]);
    expect(html.match(/<style>/g)?.length).toBe(1);
    expect(html).not.toMatch(/<link[^>]*href=/i);
  });

  it('emits [] as the JSON payload when there are no entries', () => {
    const html = renderScopesHtml([]);
    expect(extractDataPayload(html)).toEqual([]);
  });

  it('wires per-category copy CTAs and the scope selection bar', () => {
    const html = renderScopesHtml([
      { name: 'contacts:read', category: 'data_crm', apiEndpoints: [] },
    ]);

    // Render-time script builds a copy button per category box…
    expect(html).toContain('copy-category');
    expect(html).toContain('scope-check');
    // …and the static shell carries the selection text box + copy CTA.
    expect(html).toContain('id="selected-scopes"');
    expect(html).toContain('id="copy-selected"');
    expect(html).toContain('navigator.clipboard');
    // Copied values are double-quoted ("a","b") so they paste straight into
    // app-config.json's auth.scopes array.
    expect(html).toContain(`'"' + n + '"'`);
  });

  it("marks the legacy 'all' scope for deprecation badging and excludes it from copy", () => {
    const html = renderScopesHtml([{ name: 'all', category: 'account', apiEndpoints: [] }]);

    const labelsMatch = /<script type="application\/json" id="labels">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(labelsMatch).not.toBeNull();
    const labels = JSON.parse(String(labelsMatch![1]));
    expect(labels.legacyScope).toBe('all');
    expect(labels.legacyBadge).toMatch(/deprecated/i);
    // Category copy skips the legacy scope; the badge replaces its checkbox.
    expect(html).toContain('e.name !== labels.legacyScope');
  });

  it('links the public CLI reference from the footer', () => {
    const html = renderScopesHtml([]);
    expect(html).toContain('https://developers.brevo.com/docs/cli-reference');
  });

  it('renders a hero CTA linking the scope catalog docs', () => {
    const html = renderScopesHtml([]);
    expect(html).toContain(
      '<a class="docs-cta" href="https://developers.brevo.com/docs/oauth-scopes#scope-catalog"',
    );
  });

  it('includes the source URL and scope count in the intro', () => {
    const html = renderScopesHtml([
      { name: 'a', category: 'x', apiEndpoints: [] },
      { name: 'b', category: 'x', apiEndpoints: [] },
    ]);

    expect(html).toContain('https://oauth.brevo.com/realms/partner/scopes');
    expect(html).toContain('<span id="scopes-count">2</span>');
  });
});
