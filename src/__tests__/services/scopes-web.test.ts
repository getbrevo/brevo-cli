import { startScopesWebServer } from '../../services/scopes-web';

describe('startScopesWebServer', () => {
  it('serves the rendered HTML on GET / and 404s elsewhere', async () => {
    const server = await startScopesWebServer([
      { name: 'contacts:read', category: 'data_crm', apiEndpoints: ['/contacts'] },
    ]);

    try {
      const root = await fetch(server.url);
      expect(root.status).toBe(200);
      expect(root.headers.get('content-type')).toContain('text/html');
      const body = await root.text();
      // Initial entries embedded as JSON in the page so the client renderer can mount them
      expect(body).toContain('"contacts:read"');
      expect(body).toContain('"/contacts"');

      const other = await fetch(`${server.url}does-not-exist`);
      expect(other.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('serves GET /scopes.json from the refetch callback', async () => {
    const initial = [{ name: 'a', category: 'x', apiEndpoints: [] }];
    const fresh = [
      { name: 'b', category: 'y', apiEndpoints: ['/b'] },
      { name: 'c', category: 'y', apiEndpoints: [] },
    ];
    const refetch = jest.fn().mockResolvedValue(fresh);
    const server = await startScopesWebServer(initial, { refetch });

    try {
      const res = await fetch(`${server.url}scopes.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body).toEqual({ scopes: fresh });
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it('falls back to the initial entries when no refetch is provided', async () => {
    const initial = [{ name: 'only', category: 'x', apiEndpoints: [] }];
    const server = await startScopesWebServer(initial);
    try {
      const res = await fetch(`${server.url}scopes.json`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ scopes: initial });
    } finally {
      await server.close();
    }
  });

  it('returns 502 when refetch rejects', async () => {
    const refetch = jest.fn().mockRejectedValue(new Error('upstream down'));
    const server = await startScopesWebServer([], { refetch });
    try {
      const res = await fetch(`${server.url}scopes.json`);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'refetch_failed' });
    } finally {
      await server.close();
    }
  });

  it('binds to 127.0.0.1 on an ephemeral port', async () => {
    const server = await startScopesWebServer([]);
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    } finally {
      await server.close();
    }
  });

  it('close() resolves and the server stops accepting connections', async () => {
    const server = await startScopesWebServer([]);
    await server.close();

    await expect(fetch(server.url)).rejects.toThrow();
  });
});
