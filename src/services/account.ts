import { ApiClient } from '../api/client';
import { ENDPOINTS } from '../lib/constants';
import { AccountResponse, SubAccount, SubAccountsResponse } from '../types';

/**
 * Conservative fixed page size. The public reference documents no `limit` cap, so
 * page in known-safe chunks rather than guessing a maximum the server may reject.
 */
const SUB_ACCOUNT_PAGE_SIZE = 50;

/**
 * Backstop on the paging loop. `count` is the documented terminator, but it is
 * server-supplied — a wrong or drifting value must not spin the CLI forever.
 */
const SUB_ACCOUNT_MAX_PAGES = 40;

export function createAccountService(client: ApiClient) {
  return {
    validateApiKey(apiKey: string): Promise<AccountResponse> {
      return client.getWithKey<AccountResponse>(ENDPOINTS.ACCOUNT, apiKey);
    },
    getAccount(): Promise<AccountResponse> {
      return client.get<AccountResponse>(ENDPOINTS.ACCOUNT);
    },

    /**
     * Every sub-account of the authenticated master account, paged to exhaustion
     * (BEX-290). Returns rows verbatim — filtering (notably on `active`) belongs to
     * the caller that renders them, not here.
     *
     * Stops on the first empty page as well as on `count`, so a `count` larger than
     * the rows actually returned terminates instead of looping on a fixed offset.
     */
    async fetchSubAccounts(): Promise<SubAccount[]> {
      const collected: SubAccount[] = [];

      for (let page = 0; page < SUB_ACCOUNT_MAX_PAGES; page += 1) {
        const response = await client.get<SubAccountsResponse>(
          `${ENDPOINTS.CORPORATE_SUB_ACCOUNTS}?offset=${collected.length}&limit=${SUB_ACCOUNT_PAGE_SIZE}`,
        );
        const batch = response?.subAccounts ?? [];
        collected.push(...batch);

        if (batch.length === 0 || collected.length >= (response?.count ?? 0)) break;
      }

      return collected;
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
