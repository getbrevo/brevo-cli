import { formatFileTree, printFileTree } from '../../../commands/app/project-writer';

describe('app/project-writer', () => {
  describe('printFileTree', () => {
    let stdoutSpy: jest.SpyInstance;

    beforeEach(() => {
      stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => stdoutSpy.mockRestore());

    const rows = (): string[] =>
      stdoutSpy.mock.calls
        .map((c: [string]) => c[0])
        .join('')
        .split('\n')
        .filter((row: string) => row !== '');

    // The tree used to go through `logInfo` as ONE multi-line string, so the CLI's
    // two-space gutter landed on the string rather than on each line — indenting the
    // first entry two columns deeper than its siblings.
    it('puts every row in the same gutter, first one included', () => {
      printFileTree(['.gitignore', 'AGENTS.md', 'app-config.json', 'CLAUDE.md', 'README.md']);

      const indents = new Set(rows().map((row) => /^ */.exec(row)?.[0].length));
      expect([...indents]).toEqual([4]);
    });

    it('still nests a directory under its parent', () => {
      printFileTree(['src/oauth/server.js', 'src/oauth/routes.js', 'README.md']);

      const printed = rows();
      const dir = printed.find((row) => row.includes('src/')) ?? '';
      const nested = printed.find((row) => row.includes('server.js')) ?? '';
      // The gutter is shared; the nesting is carried by the connector prefix, so the
      // child's connector starts further right than its directory's.
      expect(dir.indexOf('──')).toBeLessThan(nested.indexOf('──'));
    });
  });

  describe('formatFileTree', () => {
    // Two columns, because `printFileTree` adds the gutter per line.
    it('indents top-level entries by two columns', () => {
      const tree = formatFileTree(['a.txt', 'b.txt']).split('\n');
      expect(tree).toEqual(['  ├── a.txt', '  └── b.txt']);
    });
  });
});
