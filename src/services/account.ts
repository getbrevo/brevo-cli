import { ApiClient } from '../api/client';
import { ENDPOINTS } from '../lib/constants';
import { AccountResponse } from '../types';

export function createAccountService(client: ApiClient) {
  return {
    validateApiKey(apiKey: string): Promise<AccountResponse> {
      return client.getWithKey<AccountResponse>(ENDPOINTS.ACCOUNT, apiKey);
    },
    getAccount(): Promise<AccountResponse> {
      return client.get<AccountResponse>(ENDPOINTS.ACCOUNT);
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
