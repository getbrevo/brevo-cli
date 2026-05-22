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

  it('includes the source URL and scope count in the intro', () => {
    const html = renderScopesHtml([
      { name: 'a', category: 'x', apiEndpoints: [] },
      { name: 'b', category: 'x', apiEndpoints: [] },
    ]);

    expect(html).toContain('https://oauth.brevo.com/realms/partner/scopes');
    expect(html).toContain('<span id="scopes-count">2</span>');
  });
});
