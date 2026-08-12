import { ApiClient } from '../../api/client';
import { createAccountService } from '../../services/account';

function createMockClient() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    getWithKey: jest.fn(),
    setOnAuthFailure: jest.fn(),
  } as unknown as ApiClient;
}

describe('services/account', () => {
  let mockClient: ApiClient;
  let service: ReturnType<typeof createAccountService>;

  beforeEach(() => {
    mockClient = createMockClient();
    service = createAccountService(mockClient);
  });

  describe('validateApiKey', () => {
    it('should call getWithKey with the provided API key', async () => {
      const account = {
        email: 'test@example.com',
        companyName: 'Brevo',
        organization_id: 'org-123',
        user_id: 1001,
      };
      (mockClient.getWithKey as jest.Mock).mockResolvedValue(account);

      const result = await service.validateApiKey('my-api-key');

      expect(mockClient.getWithKey).toHaveBeenCalledWith('/v3/account/info', 'my-api-key');
      expect(result).toEqual(account);
    });

    it('should propagate errors on invalid key', async () => {
      (mockClient.getWithKey as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
      await expect(service.validateApiKey('bad-key')).rejects.toThrow('Unauthorized');
    });
  });

  describe('getAccount', () => {
    it('should call client.get for account endpoint', async () => {
      const account = { email: 'test@example.com', organization_id: 'org-123', user_id: 1001 };
      (mockClient.get as jest.Mock).mockResolvedValue(account);

      const result = await service.getAccount();

      expect(mockClient.get).toHaveBeenCalledWith('/v3/account/info');
      expect(result).toEqual(account);
    });
  });

  describe('fetchSubAccounts', () => {
    const page = (ids: number[], count: number) => ({
      count,
      subAccounts: ids.map((id) => ({ id, companyName: `Company${id}`, active: true })),
    });

    it('should request the first page with an explicit offset and limit', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue(page([1, 2], 2));

      const result = await service.fetchSubAccounts();

      expect(mockClient.get).toHaveBeenCalledTimes(1);
      expect(mockClient.get).toHaveBeenCalledWith('/v3/corporate/subAccount?offset=0&limit=50');
      expect(result.map((s) => s.id)).toEqual([1, 2]);
    });

    // `count` is the paging terminator — the endpoint has no "return everything" call.
    it('should page until count is reached, advancing the offset', async () => {
      const first = page(
        Array.from({ length: 50 }, (_, i) => i + 1),
        53,
      );
      (mockClient.get as jest.Mock)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(page([51, 52, 53], 53));

      const result = await service.fetchSubAccounts();

      expect(mockClient.get).toHaveBeenNthCalledWith(
        1,
        '/v3/corporate/subAccount?offset=0&limit=50',
      );
      expect(mockClient.get).toHaveBeenNthCalledWith(
        2,
        '/v3/corporate/subAccount?offset=50&limit=50',
      );
      expect(result).toHaveLength(53);
    });

    // A `count` larger than the rows actually returned must not spin forever on a
    // fixed offset — an empty page terminates regardless of what `count` claims.
    it('should stop on an empty page even when count disagrees', async () => {
      (mockClient.get as jest.Mock)
        .mockResolvedValueOnce(page([1, 2], 999))
        .mockResolvedValueOnce({ count: 999, subAccounts: [] });

      const result = await service.fetchSubAccounts();

      expect(mockClient.get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('should tolerate a response missing subAccounts', async () => {
      (mockClient.get as jest.Mock).mockResolvedValue({});

      await expect(service.fetchSubAccounts()).resolves.toEqual([]);
    });

    it('should propagate API errors', async () => {
      (mockClient.get as jest.Mock).mockRejectedValue(new Error('Forbidden'));

      await expect(service.fetchSubAccounts()).rejects.toThrow('Forbidden');
    });
  });
});
