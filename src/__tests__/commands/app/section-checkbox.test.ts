// Real inquirer, deliberately: this suite exists to prove the cascade works against the
// actual `CheckboxPrompt` it subclasses. Mocking inquirer here would test the subclass
// against a stand-in for exactly the private surface that could break it.
import inquirer from 'inquirer';
import {
  SECTION_CHECKBOX_PROMPT,
  isSectionSelection,
  registerSectionCheckbox,
  resetSectionCheckboxForTests,
} from '../../../commands/app/section-checkbox';

interface ChoiceLike {
  value?: unknown;
  checked?: boolean;
  short?: string;
  section?: string;
  name?: string;
}

interface PromptLike {
  opt: { choices: { choices: ChoiceLike[]; getChoice(i: number): ChoiceLike | undefined } };
  pointer: number;
  selection: string[];
  toggleChoice(index: number): void;
  getCurrentValue(): unknown[];
  onAllKey(): void;
  onInverseKey(): void;
  render(): void;
}

/** The rows a two-section picker builds: a heading per section, then its members. */
const CHOICES = [
  { name: 'Account — all 2 scopes', value: { section: 'account' }, section: 'account' },
  { name: 'account:read', value: 'account:read', short: 'account:read', section: 'account' },
  { name: 'account:write', value: 'account:write', short: 'account:write', section: 'account' },
  { name: 'Events — all 2 scopes', value: { section: 'events' }, section: 'events' },
  { name: 'events:read', value: 'events:read', short: 'events:read', section: 'events' },
  { name: 'events:write', value: 'events:write', short: 'events:write', section: 'events' },
];

/**
 * A prompt instance, constructed the way inquirer constructs one.
 *
 * The readline stand-in carries only what `ScreenManager` touches; `render` is stubbed
 * because a real render would write to the terminal, and what these cases assert is the
 * `checked` state it would have rendered.
 */
function newPrompt(): PromptLike {
  const name = registerSectionCheckbox();
  expect(name).toBe(SECTION_CHECKBOX_PROMPT);
  const registry = (inquirer.prompt as unknown as { prompts: Record<string, unknown> }).prompts;
  const PromptClass = registry[SECTION_CHECKBOX_PROMPT] as new (
    q: unknown,
    rl: unknown,
    a: unknown,
  ) => PromptLike;

  const rl = {
    output: { write: () => true, end: () => undefined, mute: () => undefined },
    input: {},
    line: '',
    on: () => rl,
    once: () => rl,
    removeListener: () => rl,
    setPrompt: () => undefined,
    write: () => undefined,
    pause: () => rl,
    resume: () => rl,
  };

  const prompt = new PromptClass(
    { type: SECTION_CHECKBOX_PROMPT, name: 'scopes', message: 'Which?', choices: CHOICES },
    rl,
    {},
  );
  prompt.render = () => undefined;
  return prompt;
}

/** Indices are into the REAL choices — inquirer's own `getChoice` skips separators. */
const INDEX = {
  accountHeading: 0,
  accountRead: 1,
  accountWrite: 2,
  eventsHeading: 3,
  eventsRead: 4,
} as const;

const checkedValues = (prompt: PromptLike): unknown[] =>
  prompt.opt.choices.choices.filter((c) => c.checked).map((c) => c.value);

describe('app/section-checkbox', () => {
  beforeEach(() => resetSectionCheckboxForTests());

  it('registers under its own name and keeps the registration', () => {
    expect(registerSectionCheckbox()).toBe(SECTION_CHECKBOX_PROMPT);
    expect(registerSectionCheckbox()).toBe(SECTION_CHECKBOX_PROMPT);
  });

  it('ticks every scope in a section when its heading is selected', () => {
    const prompt = newPrompt();

    prompt.toggleChoice(INDEX.accountHeading);

    // The members are really checked, not implied — which is the whole point: the user can
    // see what the shortcut did and can untick any one of them.
    expect(checkedValues(prompt)).toEqual([
      { section: 'account' },
      'account:read',
      'account:write',
    ]);
    // And the other section is untouched.
    expect(prompt.opt.choices.choices[INDEX.eventsRead]?.checked).not.toBe(true);
  });

  it('answers with the member values alone — a heading is a shortcut, not a value', () => {
    const prompt = newPrompt();

    prompt.toggleChoice(INDEX.accountHeading);

    expect(prompt.getCurrentValue()).toEqual(['account:read', 'account:write']);
    // The echo inquirer prints after <enter> lists the scopes, never the heading.
    expect(prompt.selection).toEqual(['account:read', 'account:write']);
    expect(prompt.getCurrentValue().some(isSectionSelection)).toBe(false);
  });

  it('unticks the heading when one of its scopes is unticked', () => {
    const prompt = newPrompt();

    prompt.toggleChoice(INDEX.accountHeading);
    prompt.toggleChoice(INDEX.accountWrite);

    // Derived, not authored: the heading means "all of them", so it cannot stay ticked.
    expect(prompt.opt.choices.choices[INDEX.accountHeading]?.checked).toBe(false);
    expect(prompt.getCurrentValue()).toEqual(['account:read']);
  });

  it('re-ticks the heading once the last missing scope is added', () => {
    const prompt = newPrompt();

    prompt.toggleChoice(INDEX.accountRead);
    expect(prompt.opt.choices.choices[INDEX.accountHeading]?.checked).toBe(false);

    prompt.toggleChoice(INDEX.accountWrite);
    expect(prompt.opt.choices.choices[INDEX.accountHeading]?.checked).toBe(true);
  });

  it('fills a partly-selected section rather than emptying it', () => {
    const prompt = newPrompt();

    prompt.toggleChoice(INDEX.accountRead);
    prompt.toggleChoice(INDEX.accountHeading);

    // The shortcut adds what is missing; it does not undo the one deliberate pick.
    expect(prompt.getCurrentValue()).toEqual(['account:read', 'account:write']);
  });

  it('clears a fully-selected section when its heading is selected again', () => {
    const prompt = newPrompt();

    prompt.toggleChoice(INDEX.accountHeading);
    prompt.toggleChoice(INDEX.accountHeading);

    expect(prompt.getCurrentValue()).toEqual([]);
    expect(prompt.opt.choices.choices[INDEX.accountHeading]?.checked).toBe(false);
  });

  it('keeps headings honest through <a> and <i>', () => {
    const prompt = newPrompt();

    prompt.onAllKey();
    expect(prompt.getCurrentValue()).toEqual([
      'account:read',
      'account:write',
      'events:read',
      'events:write',
    ]);
    expect(prompt.opt.choices.choices[INDEX.eventsHeading]?.checked).toBe(true);

    prompt.onInverseKey();
    expect(prompt.getCurrentValue()).toEqual([]);
    // Inverting flips the headings too, so they have to be recomputed from the members
    // rather than left as inquirer's own inversion leaves them.
    expect(prompt.opt.choices.choices[INDEX.accountHeading]?.checked).toBe(false);
  });

  it('recognises a section value and nothing else', () => {
    expect(isSectionSelection({ section: 'account' })).toBe(true);
    expect(isSectionSelection('account:read')).toBe(false);
    expect(isSectionSelection(null)).toBe(false);
    expect(isSectionSelection({ section: 1 })).toBe(false);
  });
});
