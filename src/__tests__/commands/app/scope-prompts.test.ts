jest.mock('inquirer', () => ({
  prompt: jest.fn(),
  registerPrompt: jest.fn(),
  // Mirrors inquirer 8's own Separator: `type: 'separator'` plus the rendered `line`,
  // which is what the grouping assertions read.
  Separator: class {
    type = 'separator';
    line: string;
    constructor(line: string) {
      this.line = line;
    }
  },
}));

// Only the network read is mocked; `groupScopesByCategory` is pure and shared with
// `app available-scopes`, so the real one groups these choices.
jest.mock('../../../services/oauth-metadata', () => ({
  ...jest.requireActual('../../../services/oauth-metadata'),
  fetchSupportedScopes: jest.fn(),
}));

import inquirer from 'inquirer';
import { ApiError } from '../../../lib/errors';
import { messages } from '../../../lang/en';
import { fetchSupportedScopes, ScopeEntry } from '../../../services/oauth-metadata';
import {
  checkScopeList,
  promptScopeSelection,
  validateM2mScopesInput,
  SCOPE_PICKER_QUESTION,
} from '../../../commands/app/scope-prompts';
import {
  SECTION_CHECKBOX_PROMPT,
  resetSectionCheckboxForTests,
} from '../../../commands/app/section-checkbox';

const mockPrompt = inquirer.prompt as unknown as jest.Mock;
const mockFetch = fetchSupportedScopes as jest.Mock;

const CATALOG: ScopeEntry[] = [
  {
    name: 'contacts:read',
    category: 'contacts_crm',
    apiEndpoints: ['/contacts'],
    description: 'Read contacts, lists and attributes',
    categoryLabel: 'Contacts & CRM',
  },
  {
    name: 'contacts:write',
    category: 'contacts_crm',
    apiEndpoints: ['/contacts'],
    description: 'Create and update contacts',
    categoryLabel: 'Contacts & CRM',
  },
  // No label and no description: the heading falls back to the raw key and the row to the
  // bare scope name.
  { name: 'events:write', category: 'events', apiEndpoints: ['/events'] },
];

interface Choice {
  type?: string;
  line?: string;
  name?: string;
  value?: unknown;
  short?: string;
}

function pickerQuestion(): Record<string, unknown> {
  const question = mockPrompt.mock.calls
    .flatMap((call) => call[0])
    .find((q: { name?: string }) => q?.name === SCOPE_PICKER_QUESTION);
  if (!question) throw new Error('the scope picker was never shown');
  return question;
}

describe('app/scope-prompts', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  const originalNoColor = process.env.NO_COLOR;
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    jest.clearAllMocks();
    // Neither set: `useColor()` then follows stdout, which under jest is not a TTY, so the
    // choice labels are plain unless a case opts in with FORCE_COLOR.
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    // Registration is memoized, so each case decides for itself whether the cascading
    // prompt is available.
    resetSectionCheckboxForTests();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      writable: true,
      value: 200,
    });
    mockFetch.mockResolvedValue(CATALOG);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForceColor;
  });

  describe('promptScopeSelection', () => {
    it('offers a multi-select grouped under the catalog’s own category labels', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      const question = pickerQuestion();
      // The cascading prompt, so ticking a heading ticks its scopes on screen.
      expect(question.type).toBe(SECTION_CHECKBOX_PROMPT);
      const choices = question.choices as Choice[];
      // Grouping is the catalog's, not the CLI's: a selectable heading for the category
      // that has more than one scope, an inert separator for the one that does not, each
      // followed by its own scopes.
      expect(choices.map((c) => c.value)).toEqual([
        { section: 'contacts_crm' },
        'contacts:read',
        'contacts:write',
        undefined,
        'events:write',
      ]);
      // Unlabelled in the response, so the raw category key heads that group — the same
      // fallback `app available-scopes` prints.
      expect(choices.filter((c) => c.type === 'separator').map((c) => c.line)).toEqual(['events']);
      expect(choices[0]?.name).toContain('Contacts & CRM');
      expect(choices[0]?.name).toContain('all 2 scopes');
    });

    it('sets a heading apart with weight — bold label, dim count', async () => {
      process.env.FORCE_COLOR = '1';
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      const choices = pickerQuestion().choices as Choice[];
      const heading = choices[0]?.name ?? '';
      expect(heading).toContain('\u001b[1mContacts & CRM\u001b[22m');
      expect(heading).toContain('\u001b[2m— all 2 scopes\u001b[22m');
      // Load-bearing: inquirer wraps the pointed row in cyan, and a full reset inside the
      // row would end that colour partway through — leaving the row the user is actually
      // on as the one without a highlight.
      expect(heading).not.toContain('\u001b[0m');
      // A scope row is left plain, so the weight is what reads as the hierarchy.
      expect(choices[1]?.name).not.toMatch(/\u001b\[/);
    });

    it('falls back to plain text when colour is off, e.g. NO_COLOR or a pipe', async () => {
      delete process.env.FORCE_COLOR;
      process.env.NO_COLOR = '1';
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      // Trimmed of the output gutter `indentChoices` adds to every label.
      const heading = (pickerQuestion().choices as Choice[])[0]?.name ?? '';
      expect(heading.trim()).toBe('Contacts & CRM — all 2 scopes');
    });

    it('degrades to a plain checkbox if the cascading prompt cannot be registered', async () => {
      // Stands in for an inquirer release that moves the internals the cascade subclasses.
      (inquirer.registerPrompt as jest.Mock).mockImplementationOnce(() => {
        throw new Error('no such prompt');
      });
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: [{ section: 'contacts_crm' }] });

      // Still resolves the heading — as a value this time, rather than as a cascade.
      await expect(promptScopeSelection()).resolves.toEqual(['contacts:read', 'contacts:write']);
      expect(pickerQuestion().type).toBe('checkbox');
    });

    it('takes a whole category when its heading is selected', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: [{ section: 'contacts_crm' }] });

      await expect(promptScopeSelection()).resolves.toEqual(['contacts:read', 'contacts:write']);
    });

    it('counts a heading plus one of its own scopes as one grant, in catalog order', async () => {
      mockPrompt.mockResolvedValue({
        [SCOPE_PICKER_QUESTION]: ['contacts:write', { section: 'contacts_crm' }, 'events:write'],
      });

      // Not `contacts:write` twice, and not in the order they were clicked — the catalog's
      // order, so the list reads the way the prompt did.
      await expect(promptScopeSelection()).resolves.toEqual([
        'contacts:read',
        'contacts:write',
        'events:write',
      ]);
    });

    it('accepts a selection of nothing but headings', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: [{ section: 'contacts_crm' }] });

      await promptScopeSelection();

      // Run against the raw answer, `checkScopeList` would reject a heading as a malformed
      // scope name — so validate has to expand first, exactly as the return path does.
      const validate = pickerQuestion().validate as (selected: unknown) => true | string;
      expect(validate([{ section: 'contacts_crm' }])).toBe(true);
      expect(validate([{ section: 'nonexistent' }])).toBe(messages.APP_CREATE_M2M_SCOPES_EMPTY);
    });

    it('echoes a heading back as the scopes it stands for, not as its own label', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: [{ section: 'contacts_crm' }] });

      await promptScopeSelection();

      // inquirer builds the post-Enter echo from `short`, and it is the only place the
      // expansion is visible: inquirer 8 cannot tick the rows below a selected heading.
      const heading = (pickerQuestion().choices as Choice[])[0];
      expect(heading?.short).toBe('contacts:read, contacts:write');
    });

    it('de-duplicates when everything is selected, the way <a> leaves it', async () => {
      // `<a>` is inquirer's own toggle-all: it checks the headings as well as the scopes.
      mockPrompt.mockResolvedValue({
        [SCOPE_PICKER_QUESTION]: [
          { section: 'contacts_crm' },
          'contacts:read',
          'contacts:write',
          'events:write',
        ],
      });

      await expect(promptScopeSelection()).resolves.toEqual([
        'contacts:read',
        'contacts:write',
        'events:write',
      ]);
    });

    it('labels a row with its description and sends only the bare scope name', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      const choices = (pickerQuestion().choices as Choice[]).filter((c) => c.value);
      const contacts = choices.find((c) => c.value === 'contacts:read');
      expect(contacts?.name).toContain('contacts:read');
      expect(contacts?.name).toContain('Read contacts, lists and attributes');
      expect(contacts?.short).toBe('contacts:read');
      // A scope the catalog gives no blurb for is just its name — never a padded blank.
      expect(choices.find((c) => c.value === 'events:write')?.name?.trim()).toBe('events:write');
    });

    it('returns the selected scope names', async () => {
      mockPrompt.mockResolvedValue({
        [SCOPE_PICKER_QUESTION]: ['contacts:read', 'events:write'],
      });

      await expect(promptScopeSelection()).resolves.toEqual(['contacts:read', 'events:write']);
    });

    it('pre-selects nothing — an M2M grant has no consent screen to review it', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      const choices = (pickerQuestion().choices as Array<Choice & { checked?: boolean }>).filter(
        (c) => c.value,
      );
      expect(choices.every((choice) => !choice.checked)).toBe(true);
    });

    it('refuses an empty selection through its own validate, rather than creating an app', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      const validate = pickerQuestion().validate as (selected: unknown) => true | string;
      expect(validate([])).toBe(messages.APP_CREATE_M2M_SCOPES_EMPTY);
      expect(validate(['contacts:read'])).toBe(true);
    });

    it('states that the scopes are fixed at creation, since there is no config to edit', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await promptScopeSelection();

      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(output).toContain(messages.APP_CREATE_M2M_SCOPES_FIXED);
    });

    it('prints nothing under quiet, but still asks — never chooses scopes for the partner', async () => {
      mockPrompt.mockResolvedValue({ [SCOPE_PICKER_QUESTION]: ['contacts:read'] });

      await expect(promptScopeSelection(true)).resolves.toEqual(['contacts:read']);

      // `--json` has to stay one parseable document, so the notice and the spinner go —
      // the question does not.
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(mockPrompt).toHaveBeenCalled();
    });

    it('resolves to null and warns when the catalog cannot be read, showing no prompt', async () => {
      mockFetch.mockRejectedValue(new ApiError('idp down', 503));

      await expect(promptScopeSelection()).resolves.toBeNull();

      expect(mockPrompt).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(output).toContain('Could not load the scope catalog');
    });

    it('resolves to null for an empty catalog — a picker with no choices is a dead end', async () => {
      mockFetch.mockResolvedValue([]);

      await expect(promptScopeSelection()).resolves.toBeNull();

      expect(mockPrompt).not.toHaveBeenCalled();
      // Same fallback, different cause: "the IdP listed nothing" must not read as "your
      // connection failed", which would send the partner off checking the wrong thing.
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(output).toContain(messages.APP_SCOPES_EMPTY);
      expect(output).not.toContain('Could not load the scope catalog');
    });
  });

  describe('checkScopeList', () => {
    it('accepts a well-formed list', () => {
      expect(checkScopeList(['contacts:read', 'crm:write'])).toBe(true);
    });

    it('refuses an empty list', () => {
      expect(checkScopeList([])).toBe(messages.APP_CREATE_M2M_SCOPES_EMPTY);
    });

    it('refuses a malformed scope, naming it', () => {
      expect(checkScopeList(['not a scope!'])).toContain('not a scope!');
    });

    it('refuses the legacy all scope — an M2M app never reaches the upload check', () => {
      expect(checkScopeList(['all'])).toBe(messages.LEGACY_ALL_SCOPE_DEPRECATED_BLOCK);
    });
  });

  describe('validateM2mScopesInput', () => {
    it('splits on commas and whitespace before checking, like the flag does', () => {
      expect(validateM2mScopesInput('contacts:read, crm:read')).toBe(true);
      expect(validateM2mScopesInput('contacts:read crm:read')).toBe(true);
    });

    it('refuses a blank answer', () => {
      expect(validateM2mScopesInput('   ')).toBe(messages.APP_CREATE_M2M_SCOPES_EMPTY);
    });
  });
});
