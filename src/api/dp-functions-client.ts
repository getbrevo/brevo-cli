import WebSocket from 'ws';
import { CliError } from '../lib/errors';
import { DP_FUNCTIONS_ENDPOINTS } from '../lib/constants';
import { logHttp, logHttpResponse, logDebug } from '../lib/logger';
import { buildCliHeaders } from '../lib/telemetry';
import type {
  DpFunction,
  SaveFunctionRequest,
  UpdateFunctionRequest,
  ValidateResult,
  ExecuteResult,
  MCPTool,
  TestDataExample,
  GenerateRequest,
  GenerateResponse,
  TicketResponse,
  WsProgressMessage,
  PlanningTurnResult,
  ListFunctionsResponse,
} from '../types';

export interface GenerateCallbacks {
  onProgress: (stage: string, message: string) => void;
  onQuestion: (turn: PlanningTurnResult) => Promise<string>;
  onStreamingCode?: (delta: string) => void;
}

export class DpFunctionsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getAuthHeader: () => Record<string, string> | undefined,
  ) {}

  // --- REST methods ---

  async listFunctions(): Promise<ListFunctionsResponse> {
    return this.request<ListFunctionsResponse>('GET', DP_FUNCTIONS_ENDPOINTS.FUNCTIONS);
  }

  async getFunction(id: string): Promise<DpFunction> {
    return this.request<DpFunction>('GET', DP_FUNCTIONS_ENDPOINTS.FUNCTION(id));
  }

  async deleteFunction(id: string): Promise<void> {
    await this.request<void>('DELETE', DP_FUNCTIONS_ENDPOINTS.FUNCTION(id));
  }

  async saveFunction(req: SaveFunctionRequest): Promise<DpFunction> {
    return this.request<DpFunction>('POST', DP_FUNCTIONS_ENDPOINTS.FUNCTIONS, req);
  }

  async updateFunction(id: string, req: UpdateFunctionRequest): Promise<DpFunction> {
    return this.request<DpFunction>('PUT', DP_FUNCTIONS_ENDPOINTS.FUNCTION(id), req);
  }

  async executeFunction(id: string, contactData: unknown): Promise<ExecuteResult> {
    return this.request<ExecuteResult>('POST', DP_FUNCTIONS_ENDPOINTS.EXECUTE_FUNCTION(id), {
      contact_data: contactData,
    });
  }

  async validateCode(code: string): Promise<ValidateResult> {
    return this.request<ValidateResult>('POST', DP_FUNCTIONS_ENDPOINTS.VALIDATE, { code });
  }

  async executeCode(code: string, contactData: unknown): Promise<ExecuteResult> {
    return this.request<ExecuteResult>('POST', DP_FUNCTIONS_ENDPOINTS.EXECUTE_CODE, {
      code,
      contact_data: contactData,
    });
  }

  async listMCPTools(): Promise<MCPTool[]> {
    const resp = await this.request<{ tools: MCPTool[] }>('GET', DP_FUNCTIONS_ENDPOINTS.MCP_TOOLS);
    return resp.tools || [];
  }

  async listTestData(): Promise<TestDataExample[]> {
    const resp = await this.request<{ examples: TestDataExample[] }>(
      'GET',
      DP_FUNCTIONS_ENDPOINTS.TEST_DATA,
    );
    return resp.examples || [];
  }

  async generateRest(req: GenerateRequest): Promise<GenerateResponse> {
    return this.request<GenerateResponse>('POST', DP_FUNCTIONS_ENDPOINTS.GENERATE, req, 120_000);
  }

  // --- WebSocket generation ---

  async getTicket(): Promise<TicketResponse> {
    return this.request<TicketResponse>('POST', DP_FUNCTIONS_ENDPOINTS.GENERATE_TICKET);
  }

  async generateWs(req: GenerateRequest, callbacks: GenerateCallbacks): Promise<GenerateResponse> {
    const ticket = await this.getTicket();
    const wsUrl = this.buildWsUrl(ticket.ticket);

    return new Promise<GenerateResponse>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      ws.on('open', () => {
        ws.send(JSON.stringify(req));
      });

      ws.on('message', async (raw: WebSocket.RawData) => {
        let msg: WsProgressMessage;
        try {
          msg = JSON.parse(raw.toString()) as WsProgressMessage;
        } catch {
          return;
        }

        switch (msg.stage) {
          case 'error':
            settle(() => reject(new CliError(msg.message)));
            ws.close();
            break;

          case 'complete':
            settle(() => resolve(msg.data as GenerateResponse));
            ws.close();
            break;

          case 'question': {
            const turn = msg.data as PlanningTurnResult;
            try {
              const answer = await callbacks.onQuestion(turn);
              ws.send(JSON.stringify({ answer }));
            } catch (err) {
              settle(() => reject(err));
              ws.close();
            }
            break;
          }

          case 'streaming_code':
            callbacks.onStreamingCode?.(msg.message);
            break;

          default:
            callbacks.onProgress(msg.stage, msg.message);
            break;
        }
      });

      ws.on('error', (err: Error) => {
        settle(() => reject(new CliError(`WebSocket error: ${err.message}`)));
      });

      ws.on('close', (code: number) => {
        settle(() => {
          if (code !== 1000) {
            reject(new CliError(`WebSocket closed unexpectedly (code ${code})`));
          }
        });
      });
    });
  }

  // --- Internal ---

  private buildHeaders(): Record<string, string> {
    const authHeader = this.getAuthHeader();

    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...buildCliHeaders(authHeader),
      ...authHeader,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.buildHeaders();

    logHttp(method, path);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new CliError(
        `Cannot reach dp-functions API at ${this.baseUrl}. Is the server running?`,
      );
    }

    logHttpResponse(response.status, path);

    const text = await response.text();
    logDebug(`response ${path}`, text.slice(0, 500));

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        errorMsg = parsed.error || parsed.message || errorMsg;
      } catch {
        // Use status text fallback
      }
      throw new CliError(errorMsg);
    }

    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(`Invalid JSON response from dp-functions API`);
    }
  }

  private buildWsUrl(ticket: string): string {
    // baseUrl already includes the path prefix (e.g. https://api.brevo.com/v3/dp-functions)
    const url = new URL(`${this.baseUrl}${DP_FUNCTIONS_ENDPOINTS.GENERATE_WS}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    return url.toString();
  }
}
