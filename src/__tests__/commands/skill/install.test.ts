jest.mock('../../../services/skill', () => {
  const actual = jest.requireActual('../../../services/skill');
  return {
    ...actual,
    skillService: { install: jest.fn() },
  };
});
jest.mock('../../../services/skill-mcp', () => {
  const actual = jest.requireActual('../../../services/skill-mcp');
  return { ...actual, registerMcp: jest.fn() };
});

import { installCommand } from '../../../commands/skill/install';
import { skillService } from '../../../services/skill';
import { registerMcp } from '../../../services/skill-mcp';
import { resetJsonOutputState } from '../../../lib/json-output';

const CLAUDE_PATH = '/home/user/.claude/skills/brevo-cli';
const MCP = {
  serverName: 'brevo',
  endpoints: { claude: 'https://mcp.example/claude', openai: 'https://mcp.example/openai' },
};

function run(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        name: 'brevo',
        version: '1.0.0',
        release: '0.1.0',
        status: 'installed',
        path: '/home/user/.claude/skills/brevo',
        agents: ['claude'],
      },
      {
        name: 'brevo-cli',
        version: '1.1.0',
        release: '0.1.0',
        status: 'installed',
        path: CLAUDE_PATH,
        agents: ['claude'],
      },
    ],
    release: '0.1.0',
    source: 'network',
    dryRun: false,
    failed: false,
    mcp: MCP,
    warnings: [],
    ...overrides,
  };
}

describe('skill/install', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  const output = () =>
    stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('') +
    stderrSpy.mock.calls.map((c: [string]) => c[0]).join('');

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    resetJsonOutputState();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('installs every catalog skill for Claude Code by default and points at the other agents', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(run());

    await installCommand({});

    expect(skillService.install).toHaveBeenCalledWith([], {
      agents: ['claude'],
      pin: undefined,
      force: undefined,
      dryRun: undefined,
    });
    expect(output()).toContain('Installed brevo@1.0.0 for claude');
    expect(output()).toContain(`Installed brevo-cli@1.1.0 for claude → ${CLAUDE_PATH}`);
    expect(output()).toContain('--agent codex,gemini');
    // Without --mcp the command is printed, not run.
    expect(registerMcp).not.toHaveBeenCalled();
    expect(output()).toContain(
      'claude mcp add --scope user --transport http brevo https://mcp.example/claude',
    );
  });

  it('passes names and flags through, without the other-agents hint when --agent is given', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(
      run({
        results: [
          {
            name: 'brevo-cli',
            version: '1.1.0',
            status: 'installed',
            path: '/a/brevo-cli',
            agents: ['codex', 'gemini'],
          },
        ],
      }),
    );

    await installCommand({
      names: ['brevo-cli'],
      agent: 'codex,gemini',
      pin: '0.1.0',
      force: true,
    });

    expect(skillService.install).toHaveBeenCalledWith(['brevo-cli'], {
      agents: ['codex', 'gemini'],
      pin: '0.1.0',
      force: true,
      dryRun: undefined,
    });
    expect(output()).toContain('for codex, gemini → /a/brevo-cli');
    expect(output()).not.toContain('--agent codex,gemini');
    // Gemini has no endpoint in this catalog: silent without --mcp.
    expect(output()).toContain('codex mcp add brevo --url');
    expect(output()).not.toContain('no MCP endpoint for gemini');
  });

  it('registers the MCP server with --mcp and reports each outcome', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(run());
    (registerMcp as jest.Mock)
      .mockReturnValueOnce({
        agent: 'claude',
        status: 'registered',
        endpoint: 'https://mcp.example/claude',
      })
      .mockReturnValueOnce({
        agent: 'codex',
        status: 'failed',
        detail: 'boom',
        command: ['codex', 'mcp', 'add'],
      })
      .mockReturnValueOnce({ agent: 'gemini', status: 'no-endpoint' });

    await installCommand({ agent: 'all', mcp: true });

    expect(registerMcp).toHaveBeenCalledTimes(3);
    expect(registerMcp).toHaveBeenCalledWith('claude', MCP);
    expect(output()).toContain('Registered the Brevo MCP server for claude');
    expect(output()).toContain('Could not register the Brevo MCP server for codex (boom)');
    expect(output()).toContain('no MCP endpoint for gemini');
  });

  it('renders already-installed, skipped and warning lines', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(
      run({
        warnings: [
          'Could not fetch the skills catalog from https://x; installing the brevo-cli skill bundled with this CLI instead.',
        ],
        results: [
          {
            name: 'brevo',
            version: '1.0.0',
            status: 'already-installed',
            path: '/p/brevo',
            agents: ['claude'],
          },
          {
            name: 'a',
            version: '1.0.0',
            status: 'skipped',
            reason: 'platform',
            detail: 'openai',
            path: '/p/a',
            agents: ['claude'],
          },
          {
            name: 'b',
            version: '1.0.0',
            status: 'skipped',
            reason: 'min-cli-version',
            detail: '9.0.0',
            path: '/p/b',
            agents: ['claude'],
          },
          {
            name: 'c',
            version: '1.0.0',
            status: 'skipped',
            reason: 'download-failed',
            detail: 'HTTP 404',
            path: '/p/c',
            agents: ['claude'],
          },
          {
            name: 'd',
            version: '1.0.0',
            status: 'skipped',
            reason: 'not-installed',
            path: '',
            agents: ['claude'],
          },
          {
            name: 'e',
            version: '1.0.0',
            release: '0.1.0',
            status: 'skipped',
            reason: 'not-in-catalog',
            path: '',
            agents: ['claude'],
          },
          { name: 'f', version: '1.0.0', status: 'skipped', path: '', agents: ['claude'] },
          {
            name: 'g',
            version: '1.0.0',
            status: 'skipped',
            reason: 'unsafe-path',
            detail: '../x.md',
            path: '',
            agents: ['claude'],
          },
        ],
      }),
    );

    await installCommand({});

    const text = output();
    expect(text).toContain('installing the brevo-cli skill bundled');
    expect(text).toContain('brevo@1.0.0 is already up to date for claude');
    expect(text).toContain('Skipped a for claude: it is written for openai');
    expect(text).toContain('Skipped b: it needs @getbrevo/cli 9.0.0 or newer');
    expect(text).toContain('Skipped c: download failed (HTTP 404)');
    expect(text).toContain('d is not installed by the CLI');
    expect(text).toContain('Skipped e: not in catalog 0.1.0');
    expect(text).toContain('Skipped f.');
    expect(text).toContain(
      'Refused g: file "../x.md" would be written outside the skill directory',
    );
    // Nothing was written, so no MCP command is printed either.
    expect(text).not.toContain('mcp add');
  });

  it('exits 1 after reporting when a skill was refused for its hash', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(
      run({
        failed: true,
        results: [
          {
            name: 'brevo',
            version: '1.0.0',
            status: 'skipped',
            reason: 'hash-mismatch',
            detail: 'expected a…, got b…',
            path: '/p/brevo',
            agents: ['claude'],
          },
        ],
      }),
    );

    await expect(installCommand({})).rejects.toThrow(/One or more skills could not be installed/);
    expect(output()).toContain('Refused brevo: the downloaded files do not match the catalog');
  });

  it('--dry-run prints what would change and the dry-run note', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(
      run({
        dryRun: true,
        results: [
          {
            name: 'brevo',
            version: '1.1.0',
            previousVersion: '1.0.0',
            status: 'updated',
            path: '/p/brevo',
            agents: ['claude'],
          },
          {
            name: 'brevo-cli',
            version: '1.1.0',
            status: 'installed',
            path: CLAUDE_PATH,
            agents: ['claude'],
          },
        ],
      }),
    );

    await installCommand({ dryRun: true });

    expect(skillService.install).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ dryRun: true }),
    );
    expect(output()).toContain('Would update brevo 1.0.0 → 1.1.0 for claude');
    expect(output()).toContain('Would install brevo-cli@1.1.0 for claude');
    expect(output()).toContain('Dry run: nothing was written.');
    expect(output()).not.toContain('mcp add');
  });

  it('outputs a single JSON document with --json, and still exits 1 on failure', async () => {
    (skillService.install as jest.Mock).mockResolvedValue(run({ failed: true }));

    await expect(installCommand({ json: true })).rejects.toThrow();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.release).toBe('0.1.0');
    expect(parsed.failed).toBe(true);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.mcp[0]).toMatchObject({ agent: 'claude', status: 'printed' });
    expect(parsed.catalog_mcp.serverName).toBe('brevo');
  });

  it('rejects an unknown agent before installing anything', async () => {
    await expect(installCommand({ agent: 'cursor' })).rejects.toThrow(/Unknown agent "cursor"/);
    expect(skillService.install).not.toHaveBeenCalled();
  });
});
