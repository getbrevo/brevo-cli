jest.mock('../../../commands/skill/install', () => ({ installCommand: jest.fn() }));
jest.mock('../../../commands/skill/uninstall', () => ({ uninstallCommand: jest.fn() }));

import { Command } from 'commander';
import { registerAll } from '../../../lib/command-registry';
import { skillCliCommandGroup, skillCommandGroup } from '../../../commands/definitions';
import { installCommand } from '../../../commands/skill/install';
import { uninstallCommand } from '../../../commands/skill/uninstall';

/**
 * `brevo skill:cli install|uninstall` are hidden aliases of
 * `brevo skill install brevo-cli` / `brevo skill uninstall brevo-cli`.
 */
describe('skill:cli aliases', () => {
  function program(): Command {
    const p = new Command().name('brevo').exitOverride();
    p.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    registerAll(p, [], [skillCommandGroup, skillCliCommandGroup]);
    return p;
  }

  beforeEach(() => jest.clearAllMocks());

  it('maps skill:cli install to skill install brevo-cli with the same flags', async () => {
    await program().parseAsync([
      'node',
      'brevo',
      'skill:cli',
      'install',
      '--agent',
      'codex,gemini',
      '--json',
    ]);
    expect(installCommand).toHaveBeenCalledWith({
      json: true,
      agent: 'codex,gemini',
      names: ['brevo-cli'],
    });
  });

  it('maps skill:cli uninstall to skill uninstall brevo-cli', async () => {
    await program().parseAsync(['node', 'brevo', 'skill:cli', 'uninstall']);
    expect(uninstallCommand).toHaveBeenCalledWith({
      json: false,
      agent: undefined,
      names: ['brevo-cli'],
    });
  });

  it('parses the new group: positional names and every flag', async () => {
    await program().parseAsync([
      'node',
      'brevo',
      'skill',
      'install',
      'brevo',
      'brevo-cli',
      '--agent',
      'all',
      '--pin',
      '0.1.0',
      '--mcp',
      '--force',
      '--dry-run',
      '--json',
    ]);
    expect(installCommand).toHaveBeenCalledWith({
      json: true,
      agent: 'all',
      pin: '0.1.0',
      mcp: true,
      force: true,
      dryRun: true,
      names: ['brevo', 'brevo-cli'],
    });

    await program().parseAsync([
      'node',
      'brevo',
      'skill',
      'uninstall',
      'brevo',
      '--agent',
      'claude',
    ]);
    expect(uninstallCommand).toHaveBeenCalledWith({
      json: false,
      agent: 'claude',
      names: ['brevo'],
    });
  });

  it('keeps the alias group out of help while the new group is listed', () => {
    const p = program();
    const visible = p.commands
      .filter((c) => !(c as unknown as { _hidden: boolean })._hidden)
      .map((c) => c.name());
    expect(visible).toContain('skill');
    expect(visible).not.toContain('skill:cli');
    expect(p.commands.map((c) => c.name())).toContain('skill:cli');
  });
});
