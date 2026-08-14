import { ApiClient } from '../api/client';
import { ENDPOINTS } from '../lib/constants';
import { DpFunction, DpFunctionListResponse, DpDraftFunctionListResponse } from '../types';

export function createFunctionService(client: ApiClient) {
  return {
    async fetchFunctionList(): Promise<DpFunctionListResponse> {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      return client.get<DpFunctionListResponse>(`${ENDPOINTS.DP_FUNCTIONS}?${params}`);
    },

    async fetchDraftFunctionList(): Promise<DpDraftFunctionListResponse> {
      const params = new URLSearchParams({ limit: '50', offset: '0', draft: 'true' });
      return client.get<DpDraftFunctionListResponse>(`${ENDPOINTS.DP_FUNCTIONS}?${params}`);
    },

    async fetchFunction(id: string): Promise<DpFunction> {
      return client.get<DpFunction>(ENDPOINTS.DP_FUNCTION(id));
    },
  };
}

export type FunctionService = ReturnType<typeof createFunctionService>;
