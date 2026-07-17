import * as fs from 'node:fs';
import { DpFunctionsClient, GenerateCallbacks } from '../api/dp-functions-client';
import { CliError } from '../lib/errors';
import { messages } from '../lang/en';
import type {
  DpFunction,
  ValidateResult,
  ExecuteResult,
  MCPTool,
  TestDataExample,
  GenerateRequest,
  GenerateResponse,
} from '../types';

export function createDpFunctionsService(client: DpFunctionsClient) {
  return {
    async fetchFunctions(): Promise<DpFunction[]> {
      const resp = await client.listFunctions();
      return resp.functions || [];
    },

    fetchFunction(id: string): Promise<DpFunction> {
      return client.getFunction(id);
    },

    removeFunction(id: string): Promise<void> {
      return client.deleteFunction(id);
    },

    discoverTools(): Promise<MCPTool[]> {
      return client.listMCPTools();
    },

    validate(code: string): Promise<ValidateResult> {
      return client.validateCode(code);
    },

    execute(code: string, data: unknown): Promise<ExecuteResult> {
      return client.executeCode(code, data);
    },

    executeStored(id: string, data: unknown): Promise<ExecuteResult> {
      return client.executeFunction(id, data);
    },

    fetchTestData(): Promise<TestDataExample[]> {
      return client.listTestData();
    },

    generateRest(req: GenerateRequest): Promise<GenerateResponse> {
      return client.generateRest(req);
    },

    generateWs(req: GenerateRequest, callbacks: GenerateCallbacks): Promise<GenerateResponse> {
      return client.generateWs(req, callbacks);
    },

    async publish(opts: {
      file: string;
      name: string;
      description?: string;
      category?: string;
      attributeId?: string;
      attributeType?: string;
      data?: unknown;
      id?: string;
    }): Promise<DpFunction> {
      // Read code from file
      if (!fs.existsSync(opts.file)) {
        throw new CliError(messages.DP_FILE_NOT_FOUND(opts.file));
      }
      const code = fs.readFileSync(opts.file, 'utf-8');

      // Step 1: Validate
      const validation = await client.validateCode(code);
      if (!validation.valid) {
        const errs = (validation.errors || []).join('\n  ');
        throw new CliError(`${messages.DP_VALIDATE_FAILED}\n  ${errs}`);
      }

      // Step 2: Test execute (if data provided)
      if (opts.data !== undefined) {
        const result = await client.executeCode(code, opts.data);
        if (!result.success) {
          throw new CliError(messages.DP_EXECUTE_FAILED(result.error || 'unknown error'));
        }
      }

      // Step 3: Save or update
      if (opts.id) {
        return client.updateFunction(opts.id, {
          name: opts.name,
          code,
          description: opts.description,
        });
      }
      return client.saveFunction({
        name: opts.name,
        code,
        description: opts.description,
        category: opts.category,
        attribute_id: opts.attributeId,
        attribute_type: opts.attributeType,
      });
    },
  };
}

export type DpFunctionsService = ReturnType<typeof createDpFunctionsService>;
