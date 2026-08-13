import { finishProject } from '../../../commands/app/finish-project';
import { messages } from '../../../lang/en';

// The writer primitives are stubbed: this suite is about the *flow* — which question is
// asked, what is written, and with which merge decision — not about rendering templates.
jest.mock('../../../commands/app/project-writer', () => ({
  runFeatureScaffold: jest.fn(() => ({ written: 6, files: [{ name: 'src/oauth/server.js' }] })),
  resolveFeatureConflict: jest.fn(),
  reportScaffoldSuccess: jest.fn(),
}));

jest.mock('../../../commands/app/scaffold-prompts', () => ({
  promptFeatureType: jest.fn(async () => 'oauth'),
  promptScaffoldFeature: jest.fn(),
}));

import {
  runFeatureScaffold,
  resolveFeatureConflict,
  reportScaffoldSuccess,
} from '../../../commands/app/project-writer';
import { promptFeatureType, promptScaffoldFeature } from '../../../commands/app/scaffold-prompts';

const BASE = {
  appId: '42',
  ctx: {} as never,
  targetDir: '/cwd/my-app',
  baseScopes: ['contacts:read'],
  cdDir: 'my-app',
  isUiApp: false,
  offerFeature: true,
  onConflict: 'merge' as const,
};

describe('finishProject', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.clearAllMocks();
    (promptScaffoldFeature as jest.Mock).mockResolvedValue(true);
    (resolveFeatureConflict as jest.Mock).mockResolvedValue('merge');
    (promptFeatureType as jest.Mock).mockResolvedValue('oauth');
    (runFeatureScaffold as jest.Mock).mockReturnValue({
      written: 6,
      files: [{ name: 'src/oauth/server.js' }],
    });
  });

  afterEach(() => stdoutSpy.mockRestore());

  const output = () => stdoutSpy.mock.calls.map((c: [string]) => c[0]).join('');

  // A UI app has no local server to generate, so the tail ends here for both commands
  // rather than offering an OAuth feature the app cannot use.
  it('stops at the next-steps box for a UI app, asking nothing', async () => {
    const result = await finishProject({ ...BASE, isUiApp: true });

    expect(promptScaffoldFeature).not.toHaveBeenCalled();
    expect(runFeatureScaffold).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelled: false, feature: null, written: 0 });
  });

  // `offerFeature: false` is what a `--json` or piped run passes. The question must not
  // be asked at all — not asked-and-defaulted — or such a run would block.
  it('asks nothing and writes no feature when the feature is not offered', async () => {
    const result = await finishProject({ ...BASE, offerFeature: false });

    expect(promptScaffoldFeature).not.toHaveBeenCalled();
    expect(promptFeatureType).not.toHaveBeenCalled();
    expect(runFeatureScaffold).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelled: false, feature: null, written: 0 });
    expect(output()).toContain('scaffold');
  });

  it('writes the feature and reports it when the offer is accepted', async () => {
    const result = await finishProject(BASE);

    expect(runFeatureScaffold).toHaveBeenCalledWith('oauth', '42', {}, '/cwd/my-app', true);
    expect(reportScaffoldSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ written: 6, scopes: ['contacts:read'], cdDir: 'my-app' }),
    );
    expect(result).toEqual({ cancelled: false, feature: 'oauth', written: 6 });
  });

  it('writes nothing but still points at scaffold when the offer is declined', async () => {
    (promptScaffoldFeature as jest.Mock).mockResolvedValue(false);

    const result = await finishProject(BASE);

    expect(runFeatureScaffold).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelled: false, feature: null, written: 0 });
  });

  describe('onConflict', () => {
    // `app scaffold` is routinely pointed at a directory that already has files, so it
    // asks. `app create` does not: the directory question was answered moments earlier
    // for this exact directory, and asking again would be the same question twice.
    it("asks when 'ask', and honours the answer", async () => {
      (resolveFeatureConflict as jest.Mock).mockResolvedValue('overwrite');

      await finishProject({ ...BASE, onConflict: 'ask' });

      expect(resolveFeatureConflict).toHaveBeenCalled();
      expect(runFeatureScaffold).toHaveBeenCalledWith('oauth', '42', {}, '/cwd/my-app', false);
    });

    it("cancels without writing when the conflict question is answered 'cancel'", async () => {
      (resolveFeatureConflict as jest.Mock).mockResolvedValue('cancel');

      const result = await finishProject({ ...BASE, onConflict: 'ask' });

      expect(runFeatureScaffold).not.toHaveBeenCalled();
      expect(reportScaffoldSuccess).not.toHaveBeenCalled();
      expect(result).toEqual({ cancelled: true });
    });

    it.each([
      ['merge', true],
      ['overwrite', false],
    ] as const)("does not ask when '%s', and merges=%s", async (mode, mergeOnly) => {
      await finishProject({ ...BASE, onConflict: mode });

      expect(resolveFeatureConflict).not.toHaveBeenCalled();
      expect(runFeatureScaffold).toHaveBeenCalledWith('oauth', '42', {}, '/cwd/my-app', mergeOnly);
    });
  });

  // The base report already surfaced any legacy-'all' substitution, so repeating it here
  // would warn twice for one config.
  it('never repeats the legacy-all warning the base report already gave', async () => {
    await finishProject(BASE);

    expect(reportScaffoldSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ legacyAllSubstituted: false }),
    );
    expect(output()).not.toContain(messages.APP_SCAFFOLD_CANCELLED);
  });
});
