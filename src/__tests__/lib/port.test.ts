import * as net from 'node:net';
import { isPortAvailable, findAvailablePort } from '../../lib/port';

// Make net.createServer mockable — the property is non-configurable so jest.spyOn fails
jest.mock('node:net', () => {
  const actual = jest.requireActual('node:net');
  return { ...actual, createServer: jest.fn(actual.createServer) };
});

/** Bind to port 0 to let the OS assign a guaranteed-free ephemeral port. */
function allocateEphemeralPort(): Promise<{ port: number; server: net.Server }> {
  return new Promise((resolve) => {
    const realCreateServer = jest.requireActual('node:net').createServer;
    const server = realCreateServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ port: addr.port, server });
    });
  });
}

describe('port utilities', () => {
  describe('isPortAvailable', () => {
    it('should return true for a free port', async () => {
      // Allocate an ephemeral port, close it, then check — guaranteed free
      const { port, server } = await allocateEphemeralPort();
      await new Promise<void>((resolve) => server.close(() => resolve()));

      const result = await isPortAvailable(port);
      expect(result).toBe(true);
    });

    it('should return false for an occupied port', async () => {
      const { port, server } = await allocateEphemeralPort();

      try {
        const result = await isPortAvailable(port);
        expect(result).toBe(false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    // Regression: a wildcard listener (e.g. Mockoon on `*:3009`) used to slip
    // past the loopback-only probe — the kernel happily lets 127.0.0.1 bind
    // underneath an 0.0.0.0/`::` wildcard, so the port looked free even when
    // it wasn't. The probe must now bind to 0.0.0.0 to catch this.
    it('should return false when the port is held by an IPv4 wildcard listener', async () => {
      const realCreateServer = jest.requireActual('node:net').createServer;
      const blocker: net.Server = realCreateServer();
      await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', () => resolve()));
      const port = (blocker.address() as net.AddressInfo).port;

      try {
        const result = await isPortAvailable(port);
        expect(result).toBe(false);
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    });

    it('should reject on unexpected errors (e.g. invalid port)', async () => {
      await expect(isPortAvailable(-1)).rejects.toThrow();
    });
  });

  describe('findAvailablePort', () => {
    it('should return the start port when it is free', async () => {
      // Allocate an ephemeral port, close it, then use as start port
      const { port: freePort, server } = await allocateEphemeralPort();
      await new Promise<void>((resolve) => server.close(() => resolve()));

      const port = await findAvailablePort(freePort);
      expect(port).toBe(freePort);
    });

    it('should skip occupied ports and return the next free one', async () => {
      const { port: occupiedPort, server } = await allocateEphemeralPort();

      try {
        const port = await findAvailablePort(occupiedPort);
        expect(port).toBeGreaterThan(occupiedPort);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('should return null when all scanned ports are busy', async () => {
      // Mock net.createServer so every port reports EADDRINUSE — deterministic
      const mockCreateServer = net.createServer as jest.Mock;
      mockCreateServer.mockClear();
      mockCreateServer.mockImplementation(() => {
        const callbacks: Record<string, (...args: unknown[]) => void> = {};
        const server = {
          once(event: string, cb: (...args: unknown[]) => void) {
            callbacks[event] = cb;
            return server;
          },
          listen() {
            const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
            err.code = 'EADDRINUSE';
            callbacks['error']?.(err);
          },
          close(cb?: () => void) {
            if (cb) cb();
          },
        };
        return server as unknown as net.Server;
      });

      try {
        const result = await findAvailablePort(3009);
        expect(result).toBeNull();
        expect(mockCreateServer).toHaveBeenCalledTimes(20);
      } finally {
        // Restore real implementation for other tests
        const actual = jest.requireActual('node:net');
        mockCreateServer.mockImplementation(actual.createServer);
      }
    });
  });
});
