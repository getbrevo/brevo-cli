/**
 * A stub brevo-skills release for the installer tests: a catalog whose hashes
 * are computed by the real contract, and a `fetch` that serves it from memory.
 * No test here touches the network; the default GitHub URLs are routed too, so
 * pins (which need a per-release URL) can be exercised without the override.
 */
import { hashFiles } from '../../services/skill-catalog';

export const STUB_CATALOG_URL = 'https://stub.test/catalog.json';
export const STUB_FILES_URL = 'https://stub.test/files';
export const LATEST_CATALOG_URL =
  'https://github.com/getbrevo/brevo-skills/releases/latest/download/catalog.json';
export const pinnedCatalogUrl = (release: string): string =>
  `https://github.com/getbrevo/brevo-skills/releases/download/v${release}/catalog.json`;
export const RAW_FILES_URL = 'https://raw.githubusercontent.com/getbrevo/brevo-skills';

export interface StubSkill {
  name: string;
  version: string;
  files: Record<string, string>;
  platforms?: string[];
  default?: boolean;
  min_cli_version?: string;
  summary?: string;
  /** Overrides the computed hash, to simulate tampering upstream. */
  sha256?: string;
}

export const STUB_SKILLS: StubSkill[] = [
  {
    name: 'brevo',
    version: '1.0.0',
    default: true,
    platforms: ['claude', 'openai', 'gemini'],
    summary: 'Start here for any Brevo request.',
    files: { 'SKILL.md': '# brevo router v1.0.0\n' },
  },
  {
    name: 'brevo-cli',
    version: '1.1.0',
    platforms: ['claude', 'openai', 'gemini'],
    min_cli_version: '0.1.0',
    summary: 'Use the Brevo Developer CLI.',
    files: { 'SKILL.md': '# brevo-cli v1.1.0\n', 'references/commands.md': 'commands\n' },
  },
  {
    name: 'email-test-send',
    version: '1.0.0',
    platforms: ['claude', 'openai'],
    summary: 'Send a test of a template.',
    files: { 'SKILL.md': '# email-test-send v1.0.0\n' },
  },
];

export function skillEntry(skill: StubSkill): Record<string, unknown> {
  const files = Object.keys(skill.files).sort();
  return {
    name: skill.name,
    version: skill.version,
    status: 'public',
    owner: 'brevo',
    summary: skill.summary ?? '',
    default: skill.default ?? false,
    platforms: skill.platforms ?? ['claude', 'openai', 'gemini'],
    requires: [],
    requires_tools: [],
    min_cli_version: skill.min_cli_version,
    path: `skills/${skill.name}`,
    files,
    sha256:
      skill.sha256 ??
      hashFiles(files.map((f) => ({ path: f, bytes: Buffer.from(skill.files[f]!, 'utf-8') }))),
  };
}

export function makeCatalog(
  skills: StubSkill[] = STUB_SKILLS,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: '0.1.0',
    plugin: 'brevo',
    mcp: {
      serverName: 'brevo',
      endpoints: {
        claude: 'https://mcp.brevo.example/claude',
        openai: 'https://mcp.brevo.example/openai',
        gemini: 'https://mcp.brevo.example/gemini',
      },
    },
    skills: skills.map(skillEntry),
    ...overrides,
  };
}

export type Route = string | Buffer | { status: number; body?: string } | 'hang' | Error;

/**
 * A `fetch` that answers from a URL → body map. A missing route is a 404; a
 * `'hang'` route never resolves until the signal aborts, for the timeout tests.
 */
export function makeFetch(routes: Record<string, Route>): jest.Mock & typeof fetch {
  const impl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    if (route instanceof Error) throw route;
    if (route === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    if (typeof route === 'object' && !Buffer.isBuffer(route)) {
      return new Response(route.body ?? '', { status: route.status });
    }
    return new Response(route, { status: 200 });
  });
  return impl as unknown as jest.Mock & typeof fetch;
}

/** Routes serving `catalog` as the latest release at the stub URLs (and the GitHub ones). */
export function releaseRoutes(
  catalog: Record<string, unknown>,
  skills: StubSkill[] = STUB_SKILLS,
): Record<string, Route> {
  const release = catalog.version as string;
  const routes: Record<string, Route> = {
    [STUB_CATALOG_URL]: JSON.stringify(catalog),
    [LATEST_CATALOG_URL]: JSON.stringify(catalog),
    [pinnedCatalogUrl(release)]: JSON.stringify(catalog),
  };
  for (const skill of skills) {
    for (const [file, body] of Object.entries(skill.files)) {
      routes[`${STUB_FILES_URL}/v${release}/skills/${skill.name}/${file}`] = body;
      routes[`${RAW_FILES_URL}/v${release}/skills/${skill.name}/${file}`] = body;
    }
  }
  return routes;
}
