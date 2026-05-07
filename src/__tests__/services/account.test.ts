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

      expect(mockClient.getWithKey).toHaveBeenCalledWith('/v3/account', 'my-api-key');
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

      expect(mockClient.get).toHaveBeenCalledWith('/v3/account');
      expect(result).toEqual(account);
    });
  });
});
