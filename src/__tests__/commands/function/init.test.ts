import { CliError } from '../../../lib/errors';

jest.mock('inquirer', () => ({
  prompt: jest.fn(),
}));

const mockFunctionService = {
  fetchTemplates: jest.fn(),
  createFunction: jest.fn(),
  generateStream: jest.fn(),
  iterateStream: jest.fn(),
  fetchContacts: jest.fn(),
  executeTemplate: jest.fn(),
  createFromTemplate: jest.fn(),
};

const mockAppService = {
  fetchAppsList: jest.fn(),
};

jest.mock('../../../services/function', () => ({
  createFunctionService: jest.fn(() => mockFunctionService),
}));

jest.mock('../../../container', () => ({
  appService: mockAppService,
  client: {},
  sseDeps: { baseUrl: 'https://test.example.com', getAuthHeader: () => ({}) },
}));

import inquirer from 'inquirer';
import { initFunctionCommand } from '../../../commands/function/init';

// Aliases for shorter references in tests
const appService = mockAppService;
const functionService = mockFunctionService;

function mockApp(overrides: Record<string, unknown> = {}) {
  return {
    app_id: 'app-001',
    name: 'Test App',
    client_id: 'client-001',
    client_secret: 'secret-001',
    distribution_type: 'private',
    redirect_uris: ['http://localhost:3009/auth/callback'],
    scopes: ['contacts:read'],
    ...overrides,
  };
}

describe('function/init', () => {
  let stdoutSpy: jest.SpyInstance;
  const origTTY = process.stdin.isTTY;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    (process.stderr.write as jest.Mock).mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', {
      value: origTTY,
      writable: true,
      configurable: true,
    });
  });

  it('should refuse --json mode', async () => {
    await expect(initFunctionCommand({ json: true })).rejects.toThrow(CliError);
    await expect(initFunctionCommand({ json: true })).rejects.toThrow('interactive terminal');
  });

  it('should refuse non-TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    await expect(initFunctionCommand({ json: false })).rejects.toThrow(CliError);
  });

  it('should throw when no eligible apps found', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    await expect(initFunctionCommand({ json: false })).rejects.toThrow('No Brevo Function apps');
  });

  it('should throw when no brevo_function apps exist', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([]);

    await expect(initFunctionCommand({ json: false })).rejects.toThrow('No Brevo Function apps');
  });

  it('should prompt for app selection even with one eligible app', async () => {
    const app = mockApp();
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([app]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'template' };
        case 3:
          return { templateId: 'tmpl-1' };
        case 4:
          return { functionName: 'My Function' };
        case 5:
          return { confirmDeploy: true };
        default:
          return {};
      }
    });

    (functionService.fetchTemplates as jest.Mock).mockResolvedValue([
      {
        id: 'tmpl-1',
        name: 'Template 1',
        description: 'A template',
        formula: 'return 1;',
        attribute_id: 'FUNC_T1',
        category: 'scoring',
      },
    ]);
    (functionService.fetchContacts as jest.Mock).mockResolvedValue({
      contacts: [{ id: 100, email_tag: 'test' }],
    });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({ result: [] });
    (functionService.createFromTemplate as jest.Mock).mockResolvedValue({
      id: 'fn-new',
      name: 'My Function',
      version: 1,
    });

    await initFunctionCommand({ json: false });

    // First prompt should be app selection
    const firstPromptArgs = (inquirer.prompt as unknown as jest.Mock).mock.calls[0][0];
    expect(firstPromptArgs[0].message).toContain('Select a Brevo Function app');
    expect(functionService.createFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ global_function_id: 'tmpl-1', name: 'My Function', source: 'cli' }),
    );
  });

  it('should prompt for app selection when multiple eligible apps exist', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      mockApp({ app_id: 'app-001', name: 'App One' }),
      mockApp({ app_id: 'app-002', name: 'App Two' }),
    ]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-002' };
        case 2:
          return { method: 'template' };
        case 3:
          return { templateId: 'tmpl-1' };
        case 4:
          return { functionName: 'Template 1' };
        case 5:
          return { confirmDeploy: true };
        default:
          return {};
      }
    });

    (functionService.fetchTemplates as jest.Mock).mockResolvedValue([
      {
        id: 'tmpl-1',
        name: 'Template 1',
        description: 'A template',
        formula: 'return 1;',
        attribute_id: 'FUNC_T1',
        category: 'scoring',
      },
    ]);
    (functionService.fetchContacts as jest.Mock).mockResolvedValue({
      contacts: [{ id: 100, email_tag: 'test' }],
    });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({ result: [] });
    (functionService.createFromTemplate as jest.Mock).mockResolvedValue({
      id: 'fn-new',
      name: 'Template 1',
      version: 1,
    });

    await initFunctionCommand({ json: false });

    // First prompt should be app selection
    const firstPromptArgs = (inquirer.prompt as unknown as jest.Mock).mock.calls[0][0];
    expect(firstPromptArgs[0].message).toContain('Select a Brevo Function app');
    expect(functionService.createFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ global_function_id: 'tmpl-1', source: 'cli' }),
    );
  });

  it('should handle AI generation happy path', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'ai' }; // method prompt
        case 3:
          return { description: 'Score leads based on activity' }; // description prompt
        case 4:
          return { action: 'save' }; // deploy
        case 5:
          return { functionName: 'Score Leads' }; // name prompt
        case 6:
          return { confirmDeploy: true }; // confirm deploy
        default:
          return {};
      }
    });

    (functionService.generateStream as jest.Mock).mockImplementation(async function* () {
      yield {
        data: JSON.stringify({
          type: 'CUSTOM',
          value: { message: 'Enriching...', stage: 'enriching' },
        }),
      };
      yield {
        data: JSON.stringify({
          type: 'CUSTOM',
          value: { message: 'Generating...', stage: 'executing_agent' },
        }),
      };
      yield {
        data: JSON.stringify({
          result: {
            code: 'return score;',
            draft_id: 'd-1',
            session_id: 's-1',
            category: 'scoring',
          },
        }),
      };
    });

    (functionService.fetchContacts as jest.Mock).mockResolvedValue({
      contacts: [{ id: 100, email_tag: 'test' }],
    });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({ result: [] });

    (functionService.createFunction as jest.Mock).mockResolvedValue({
      id: 'fn-new',
      name: 'Score Leads',
      version: 1,
    });

    await initFunctionCommand({ json: false });

    expect(functionService.generateStream).toHaveBeenCalled();
    expect(functionService.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return score;',
        name: 'Score Leads',
        category: 'scoring',
        app_id: 'app-001',
        attribute_id: 'SCORE_LEADS',
      }),
    );

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function deployed');
    expect(output).toContain('Score Leads');
  });

  it('should handle AI generation iteration loop', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'ai' };
        case 3:
          return { description: 'initial prompt' };
        case 4:
          return { action: 'update' }; // iterate
        case 5:
          return { iterateDescription: 'add error handling' };
        case 6:
          return { action: 'save' }; // deploy
        case 7:
          return { functionName: 'My Fn' }; // name prompt
        case 8:
          return { confirmDeploy: true }; // confirm deploy
        default:
          return {};
      }
    });

    (functionService.generateStream as jest.Mock).mockImplementation(async function* () {
      yield {
        data: JSON.stringify({ result: { code: 'v1', draft_id: 'd-1', session_id: 's-1' } }),
      };
    });

    (functionService.iterateStream as jest.Mock).mockImplementation(async function* () {
      yield { data: JSON.stringify({ result: { code: 'v2', draft_id: 'd-2' } }) };
    });

    (functionService.fetchContacts as jest.Mock).mockResolvedValue({
      contacts: [{ id: 200, email_tag: 'iter' }],
    });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({
      result: [{ contact_id: '200', score: 42 }],
    });

    (functionService.createFunction as jest.Mock).mockResolvedValue({
      id: 'fn-new',
      name: 'My Fn',
      version: 1,
    });

    await initFunctionCommand({ json: false });

    expect(functionService.iterateStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        draft_function_id: 'd-1',
        user_prompt: 'add error handling',
        previous_code: 'v1',
        source: 'cli',
      }),
    );

    // Preview should be executed after iterate with updated draft_id
    expect(functionService.fetchContacts).toHaveBeenCalled();
    expect(functionService.executeTemplate).toHaveBeenCalledWith({
      code: 'v2',
      contact_data: [{ id: 200, email_tag: 'iter' }],
    });

    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('contact_id');
    expect(output).toContain('42');

    expect(functionService.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'v2' }),
    );
  });

  it('should handle template selection success', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'template' };
        case 3:
          return { templateId: 'tmpl-2' };
        case 4:
          return { functionName: 'Custom Name' };
        case 5:
          return { confirmDeploy: true };
        default:
          return {};
      }
    });

    (functionService.fetchTemplates as jest.Mock).mockResolvedValue([
      {
        id: 'tmpl-1',
        name: 'Template A',
        description: 'First',
        formula: 'formulaA',
        attribute_id: 'FUNC_A',
        category: 'scoring',
      },
      {
        id: 'tmpl-2',
        name: 'Template B',
        description: 'Second',
        formula: 'formulaB',
        category: 'scoring',
        attribute_id: 'FUNC_B',
      },
    ]);
    (functionService.fetchContacts as jest.Mock).mockResolvedValue({
      contacts: [{ id: 100, email_tag: 'test' }],
    });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({
      result: [
        { contact_id: '100', avg_order_value: 195.08 },
        { contact_id: '101', avg_order_value: 182.62 },
      ],
    });
    (functionService.createFromTemplate as jest.Mock).mockResolvedValue({
      id: 'fn-tmpl',
      name: 'Custom Name',
      version: 1,
    });

    await initFunctionCommand({ json: false });

    // Verify the full flow
    expect(functionService.fetchContacts).toHaveBeenCalled();
    expect(functionService.executeTemplate).toHaveBeenCalledWith({
      template_id: 'tmpl-2',
      contact_data: [{ id: 100, email_tag: 'test' }],
    });
    expect(functionService.createFromTemplate).toHaveBeenCalledWith({
      global_function_id: 'tmpl-2',
      name: 'Custom Name',
      description: 'Second',
      category: 'scoring',
      attribute_id: 'CUSTOM_NAME',
      source: 'cli',
    });
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Function deployed');
    expect(output).toContain('Custom Name');
    // Verify preview shows template info
    expect(output).toContain('Attribute ID:');
    expect(output).toContain('FUNC_B');
    expect(output).toContain('Description:');
    // Verify execute results table is printed
    expect(output).toContain('contact_id');
    expect(output).toContain('avg_order_value');
    expect(output).toContain('195.08');
    expect(output).toContain('182.62');
  });

  it('should cancel when user declines deploy', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'template' };
        case 3:
          return { templateId: 'tmpl-1' };
        case 4:
          return { functionName: 'My Fn' };
        case 5:
          return { confirmDeploy: false };
        default:
          return {};
      }
    });

    (functionService.fetchTemplates as jest.Mock).mockResolvedValue([
      {
        id: 'tmpl-1',
        name: 'T1',
        description: 'desc',
        formula: 'f',
        attribute_id: 'FUNC_T1',
        category: 'cat',
      },
    ]);
    (functionService.fetchContacts as jest.Mock).mockResolvedValue({ contacts: [] });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({ result: [] });

    await initFunctionCommand({ json: false });

    // createFromTemplate should NOT have been called
    expect(functionService.createFromTemplate).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');
    expect(output).toContain('Deployment cancelled');
  });

  it('should throw when no templates available', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'template' };
        default:
          return {};
      }
    });

    (functionService.fetchTemplates as jest.Mock).mockResolvedValue([]);

    await expect(initFunctionCommand({ json: false })).rejects.toThrow('No templates available');
  });

  it('should handle generation failure (no code in stream)', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'ai' };
        case 3:
          return { description: 'will fail' };
        default:
          return {};
      }
    });

    (functionService.generateStream as jest.Mock).mockImplementation(async function* () {
      yield {
        data: JSON.stringify({
          type: 'CUSTOM',
          value: { message: 'Enriching...', stage: 'enriching' },
        }),
      };
      // No result event with code
    });

    await expect(initFunctionCommand({ json: false })).rejects.toThrow(
      'Failed to generate function',
    );
  });

  it('should handle SSE error event', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([mockApp()]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'app-001' }; // app selection
        case 2:
          return { method: 'ai' };
        case 3:
          return { description: 'test error' };
        default:
          return {};
      }
    });

    (functionService.generateStream as jest.Mock).mockImplementation(async function* () {
      yield { data: JSON.stringify({ error: 'Generation quota exceeded' }) };
    });

    await expect(initFunctionCommand({ json: false })).rejects.toThrow(
      'Failed to generate function',
    );
  });

  it('should filter out public apps from eligible list', async () => {
    (appService.fetchAppsList as jest.Mock).mockResolvedValue([
      mockApp({ app_id: 'pub-1', distribution_type: 'public' }),
      mockApp({ app_id: 'priv-1', distribution_type: 'private' }),
    ]);

    let promptCall = 0;
    (inquirer.prompt as unknown as jest.Mock).mockImplementation(() => {
      promptCall++;
      switch (promptCall) {
        case 1:
          return { selected: 'priv-1' }; // app selection (only private app)
        case 2:
          return { method: 'template' };
        case 3:
          return { templateId: 'tmpl-1' };
        case 4:
          return { functionName: 'T1' };
        case 5:
          return { confirmDeploy: true };
        default:
          return {};
      }
    });

    (functionService.fetchTemplates as jest.Mock).mockResolvedValue([
      {
        id: 'tmpl-1',
        name: 'T1',
        description: 'd',
        formula: 'f',
        attribute_id: 'FUNC_T1',
        category: 'cat',
      },
    ]);
    (functionService.fetchContacts as jest.Mock).mockResolvedValue({ contacts: [] });
    (functionService.executeTemplate as jest.Mock).mockResolvedValue({ result: [] });
    (functionService.createFromTemplate as jest.Mock).mockResolvedValue({
      id: 'fn-1',
      name: 'T1',
      version: 1,
    });

    await initFunctionCommand({ json: false });

    // Should auto-select the only private app
    expect(functionService.createFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ global_function_id: 'tmpl-1', source: 'cli' }),
    );
  });
});
