import { sseStream, SSEStreamDeps } from '../../api/sse-stream';
import { ApiError } from '../../lib/errors';

// Stub buildCliHeaders so it doesn't pull real telemetry deps
jest.mock('../../lib/telemetry', () => ({
  buildCliHeaders: () => ({ 'User-Agent': 'brevo-cli/test' }),
}));

function createMockDeps(): SSEStreamDeps {
  return {
    baseUrl: 'https://api.example.com',
    getAuthHeader: () => ({ 'api-key': 'xkeysib-test-key' }),
  };
}

/**
 * Build a ReadableStream from chunks of text, simulating an SSE body.
 */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe('sseStream', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should parse a single SSE event', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks(['data: {"stage":"enriching"}\n\n']),
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toEqual([{ event: undefined, data: '{"stage":"enriching"}' }]);
  });

  it('should parse multiple SSE events', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks([
        'data: {"stage":"enriching"}\n\n',
        'data: {"stage":"generating"}\n\n',
        'data: {"code":"return 42;"}\n\n',
      ]),
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]!.data).toBe('{"stage":"enriching"}');
    expect(events[1]!.data).toBe('{"stage":"generating"}');
    expect(events[2]!.data).toBe('{"code":"return 42;"}');
  });

  it('should handle event: and data: pairing', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks(['event: progress\ndata: {"stage":"planning"}\n\n']),
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toEqual([{ event: 'progress', data: '{"stage":"planning"}' }]);
  });

  it('should buffer partial lines across chunks', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks(['data: {"sta', 'ge":"enriching"}\n\n']),
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toEqual([{ event: undefined, data: '{"stage":"enriching"}' }]);
  });

  it('should throw ApiError on non-200 response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('{"message":"Internal Server Error"}'),
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
        // should not reach here
      }
    }).rejects.toThrow(ApiError);
  });

  it('should use error message from response body', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue('{"message":"Bad request: missing prompt"}'),
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
        // should not reach here
      }
    }).rejects.toThrow('Bad request: missing prompt');
  });

  it('should throw ApiError on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
        // should not reach here
      }
    }).rejects.toThrow(ApiError);
  });

  it('should handle empty body gracefully', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });

  it('should flush remaining data when stream ends without trailing blank line', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks(['data: {"code":"final"}\n']),
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toEqual([{ event: undefined, data: '{"code":"final"}' }]);
  });

  it('should handle \\r\\n line endings', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks(['data: {"ok":true}\r\n\r\n']),
    });

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'POST', '/api/generate/stream', {})) {
      events.push(event);
    }

    expect(events).toEqual([{ event: undefined, data: '{"ok":true}' }]);
  });

  it('should send correct headers and method', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks([]),
    });
    globalThis.fetch = mockFetch;

    const events = [];
    for await (const event of sseStream(createMockDeps(), 'PATCH', '/api/iterate', {
      prompt: 'hello',
    })) {
      events.push(event);
    }

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/iterate',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'api-key': 'xkeysib-test-key',
        }),
        body: '{"prompt":"hello"}',
      }),
    );
  });
});
