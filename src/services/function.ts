import { ApiClient } from '../api/client';
import { SSEStreamDeps, SSEEvent, sseStream } from '../api/sse-stream';
import { ENDPOINTS } from '../lib/constants';
import {
  DpFunction,
  DpFunctionListResponse,
  DpDraftFunctionListResponse,
  FunctionCreateRequest,
  FunctionCreateResponse,
  FunctionGenerateRequest,
  FunctionIterateRequest,
  FunctionTemplate,
  FunctionContactsResponse,
  FunctionExecuteRequest,
  FunctionExecuteResponse,
  FunctionCreateFromTemplateRequest,
  LinkFunctionToAppRequest,
  LinkFunctionToAppResponse,
} from '../types';

export function createFunctionService(client: ApiClient) {
  return {
    async fetchFunctionList(): Promise<DpFunctionListResponse> {
      const PAGE_SIZE = 50;
      const all: DpFunction[] = [];
      let offset = 0;
      let last: DpFunctionListResponse;
      do {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        last = await client.get<DpFunctionListResponse>(`${ENDPOINTS.DP_FUNCTIONS}?${params}`);
        all.push(...(last.functions ?? []));
        offset += PAGE_SIZE;
      } while (all.length < last.total);
      return { ...last, functions: all };
    },

    async fetchDraftFunctionList(): Promise<DpDraftFunctionListResponse> {
      const PAGE_SIZE = 50;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0', draft: 'true' });
      return client.get<DpDraftFunctionListResponse>(`${ENDPOINTS.DP_FUNCTIONS}?${params}`);
    },

    async fetchFunction(id: string): Promise<DpFunction> {
      return client.get<DpFunction>(ENDPOINTS.DP_FUNCTION(id));
    },

    async activateFunction(id: string): Promise<void> {
      await client.patch<void>(ENDPOINTS.DP_FUNCTION(id), { is_active: true });
    },

    async deactivateFunction(id: string): Promise<void> {
      await client.patch<void>(ENDPOINTS.DP_FUNCTION(id), { is_active: false });
    },

    async deleteFunction(id: string): Promise<void> {
      await client.delete<void>(ENDPOINTS.DP_FUNCTION(id));
    },

    async fetchTemplates(): Promise<FunctionTemplate[]> {
      const res = await client.get<{ templates: FunctionTemplate[] }>(
        ENDPOINTS.DP_FUNCTION_TEMPLATES,
      );
      return res.templates;
    },

    async createFunction(payload: FunctionCreateRequest): Promise<FunctionCreateResponse> {
      return client.post<FunctionCreateResponse>(ENDPOINTS.DP_FUNCTION_CREATE, payload);
    },

    async *generateStream(
      sseDeps: SSEStreamDeps,
      payload: FunctionGenerateRequest,
    ): AsyncGenerator<SSEEvent> {
      yield* sseStream(sseDeps, 'POST', ENDPOINTS.DP_FUNCTION_GENERATE_STREAM, payload);
    },

    async *iterateStream(
      sseDeps: SSEStreamDeps,
      payload: FunctionIterateRequest,
    ): AsyncGenerator<SSEEvent> {
      yield* sseStream(sseDeps, 'PATCH', ENDPOINTS.DP_FUNCTION_GENERATE_STREAM, payload);
    },

    async fetchContacts(): Promise<FunctionContactsResponse> {
      return client.post<FunctionContactsResponse>(ENDPOINTS.DP_FUNCTION_CONTACTS, {});
    },

    async executeTemplate(payload: FunctionExecuteRequest): Promise<FunctionExecuteResponse> {
      return client.post<FunctionExecuteResponse>(ENDPOINTS.DP_FUNCTION_EXECUTE, payload);
    },

    async createFromTemplate(
      payload: FunctionCreateFromTemplateRequest,
    ): Promise<FunctionCreateResponse> {
      return client.post<FunctionCreateResponse>(
        ENDPOINTS.DP_FUNCTION_CREATE_FROM_TEMPLATE,
        payload,
      );
    },

    async linkFunctionToApp(payload: LinkFunctionToAppRequest): Promise<LinkFunctionToAppResponse> {
      return client.post<LinkFunctionToAppResponse>(ENDPOINTS.APP_STORE_APP_FUNCTIONS, payload);
    },
  };
}

export type FunctionService = ReturnType<typeof createFunctionService>;
