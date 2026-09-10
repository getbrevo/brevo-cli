import inquirer from 'inquirer';
import { logDebug } from '../../lib/logger';

/**
 * A `checkbox` prompt whose SECTION HEADINGS are selectable shortcuts.
 *
 * Ticking a heading ticks every choice beneath it, so the selection is visible rather than
 * implied, and any one of them can then be unticked. A heading's own tick is derived — it
 * means "every choice in this section is on" — and it never appears in the answer: the
 * prompt resolves to the member values alone, exactly as a plain `checkbox` would.
 *
 * **This subclasses inquirer 8's own `CheckboxPrompt`, which is a private module.** It is
 * the only way to get the cascade: inquirer cannot tick one choice in response to another
 * being ticked, and a prompt cannot reach its own choices from the question object. The
 * coupling is deliberately small — four methods, listed in {@link CheckboxPromptInstance} —
 * and it is confined to this file so that the surface to re-check on an inquirer bump is
 * one import and one class.
 *
 * The registration is guarded for the same reason. A bare deep import would run at module
 * load, so an inquirer release that moves the file would not degrade this prompt, it would
 * make `brevo app create` die at startup. {@link registerSectionCheckbox} therefore returns
 * `null` on any failure and the caller falls back to a plain `checkbox`, where a heading is
 * a value to be expanded rather than a cascade.
 */

export const SECTION_CHECKBOX_PROMPT = 'brevo-section-checkbox';

/**
 * The value of a section heading: it stands for every member of that section.
 *
 * An object rather than a magic string so it can never collide with a real member value,
 * and so recognising one is a type check rather than a parse.
 */
export interface SectionSelection {
  section: string;
}

export function isSectionSelection(value: unknown): value is SectionSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SectionSelection).section === 'string'
  );
}

/**
 * One row as inquirer keeps it. `section` is ours: inquirer's `Choice` constructor copies
 * every own property off the object it is given, so a choice can carry which section it
 * belongs to and the cascade needs no separate map.
 */
interface ChoiceState {
  type?: string;
  value?: unknown;
  checked?: boolean;
  disabled?: unknown;
  short?: string;
  section?: string;
}

/** The `Choices` collection, narrowed to what the cascade reads. */
interface ChoicesState {
  choices: ChoiceState[];
  getChoice(index: number): ChoiceState | undefined;
}

/** The private surface this file depends on. Everything here is inquirer 8 internal. */
interface CheckboxPromptInstance {
  opt: { choices: ChoicesState };
  pointer: number;
  selection: string[];
  toggleChoice(index: number): void;
  getCurrentValue(): unknown[];
  onAllKey(): void;
  onInverseKey(): void;
  render(): void;
}

type CheckboxPromptCtor = new (...args: never[]) => CheckboxPromptInstance;

/** Every member choice of one section, headings excluded (their value is not a member's). */
function membersOf(choices: ChoicesState, section: string): ChoiceState[] {
  return choices.choices.filter(
    (choice) => choice.section === section && !isSectionSelection(choice.value),
  );
}

/**
 * Recompute every heading's tick from its members.
 *
 * Derived, never authored: unticking one scope unticks its heading, and ticking the last
 * missing one ticks it back. That is what keeps the heading honest as an indicator once it
 * has been used as a shortcut.
 */
function syncHeadings(choices: ChoicesState): void {
  for (const choice of choices.choices) {
    if (!isSectionSelection(choice.value)) continue;
    const members = membersOf(choices, choice.value.section);
    choice.checked = members.length > 0 && members.every((member) => member.checked === true);
  }
}

/** `undefined` until the first attempt; then the prompt's name, or `null` if unavailable. */
let registration: string | null | undefined;

/**
 * Register the prompt, once, and return the name to ask under — or `null` if inquirer's
 * internals have moved, in which case the caller must degrade rather than crash.
 */
export function registerSectionCheckbox(): string | null {
  if (registration !== undefined) return registration;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CheckboxPrompt = require('inquirer/lib/prompts/checkbox') as CheckboxPromptCtor;

    class SectionCheckboxPrompt extends CheckboxPrompt {
      /**
       * Both toggle paths — `<space>` and the number keys — route through here, which is
       * why the cascade lives on this method rather than on `onSpaceKey`.
       *
       * Rendering stays the caller's job, as in the base class.
       */
      override toggleChoice(index: number): void {
        const choice = this.opt.choices.getChoice(index);
        if (choice && isSectionSelection(choice.value)) {
          const members = membersOf(this.opt.choices, choice.value.section);
          // Partly-selected sections fill up rather than empty out — the shortcut's job is
          // to add the ones that are missing.
          const turningOn = members.some((member) => member.checked !== true);
          for (const member of members) member.checked = turningOn;
        } else {
          super.toggleChoice(index);
        }
        syncHeadings(this.opt.choices);
      }

      /** `<a>`: the base class checks the headings too, so they only need reconciling. */
      override onAllKey(): void {
        super.onAllKey();
        syncHeadings(this.opt.choices);
        this.render();
      }

      /** `<i>`: inverting members can leave a heading disagreeing with them. */
      override onInverseKey(): void {
        super.onInverseKey();
        syncHeadings(this.opt.choices);
        this.render();
      }

      /**
       * The answer, and the line echoed after `<enter>`, are the member values alone.
       *
       * A heading is a shortcut, not a choice: it says nothing the ticks beneath it do not
       * already say, and letting it through would put an object where every caller expects
       * a value. `selection` is what the base class renders once answered, so it is set
       * here too — from the members, which is now the complete list either way.
       */
      override getCurrentValue(): unknown[] {
        const picked = this.opt.choices.choices.filter(
          (choice) =>
            choice.type !== 'separator' &&
            choice.checked === true &&
            !choice.disabled &&
            !isSectionSelection(choice.value),
        );
        this.selection = picked.map((choice) => choice.short ?? String(choice.value));
        return picked.map((choice) => choice.value);
      }
    }

    // `registerPrompt` is typed for inquirer's own prompt modules; a subclass of one is
    // exactly that, but the published types cannot express it.
    inquirer.registerPrompt(
      SECTION_CHECKBOX_PROMPT,
      SectionCheckboxPrompt as unknown as Parameters<typeof inquirer.registerPrompt>[1],
    );
    registration = SECTION_CHECKBOX_PROMPT;
  } catch (err) {
    logDebug('section checkbox unavailable', { message: (err as Error).message });
    registration = null;
  }
  return registration;
}

/** Test seam: forget the memoized attempt so a case can exercise the fallback. */
export function resetSectionCheckboxForTests(): void {
  registration = undefined;
}
