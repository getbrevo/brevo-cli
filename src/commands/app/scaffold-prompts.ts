import inquirer from 'inquirer';
import { messages } from '../../lang/en';
import { FeatureType, FEATURE_TEMPLATE_MANIFESTS, FEATURE_LABELS } from '../../templates';
import { validateYesNo } from '../../lib/validators';
import { indentChoices } from '../../lib/ui';

/**
 * The two questions about scaffolding a feature, in their own module because both
 * `app create` and `app scaffold` ask them and `create` already imports `./scaffold`
 * — putting them there and importing back would close a cycle.
 *
 * Both are derived from `FEATURE_TEMPLATE_MANIFESTS`, which is the point: the CLI
 * asks *which* feature only when the manifest holds more than one, so adding a
 * second feature restores the picker with no change here.
 */

/** Every feature that can be scaffolded, in manifest order. */
function featureTypes(): FeatureType[] {
  return Object.keys(FEATURE_TEMPLATE_MANIFESTS) as FeatureType[];
}

/**
 * The one feature to scaffold when the manifest holds exactly one, undefined
 * otherwise. Undefined is what makes a prompt necessary, so callers read as "is
 * there a choice to make?" rather than counting entries themselves.
 */
function soleFeatureType(): FeatureType | undefined {
  const types = featureTypes();
  return types.length === 1 ? types[0] : undefined;
}

// The manifest is never empty; this only keeps the return type honest where
// TypeScript cannot prove an index access lands on something.
const FALLBACK_FEATURE: FeatureType = 'oauth';

/**
 * The single feature's label, or undefined once there is more than one — which is
 * what lets the confirm below name the feature while there is only one to name.
 */
export function soleFeatureLabel(): string | undefined {
  const only = soleFeatureType();
  return only ? FEATURE_LABELS[only] : undefined;
}

/**
 * Which feature to scaffold.
 *
 * A list with one entry is not a question: it is a keystroke that can only produce
 * one answer, put to a user who has already said what kind of app this is. So the
 * picker appears only once the manifest actually holds a choice — today it never
 * does, and `app create` / `app scaffold` go straight to writing the OAuth test
 * server.
 */
export async function promptFeatureType(interactive: boolean): Promise<FeatureType> {
  const types = featureTypes();
  const only = soleFeatureType();
  if (only) return only;
  if (!interactive) return types[0] ?? FALLBACK_FEATURE;
  const { featureType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'featureType',
      message: messages.APP_SCAFFOLD_FEATURE_TYPE_PROMPT,
      choices: indentChoices(types.map((type) => ({ name: FEATURE_LABELS[type], value: type }))),
    },
  ]);
  return featureType;
}

/**
 * Whether to scaffold a feature at all. Defaults to yes — pressing Enter opts in.
 *
 * Asked by `app create` once the project is written, and by `app scaffold`'s
 * bootstrap for the same reason: in both, the project itself is what the user came
 * for and the feature is an extra they can decline. The feature-add mode of
 * `scaffold` does not ask — there, scaffolding a feature *is* the request.
 */
export async function promptScaffoldFeature(): Promise<boolean> {
  const { scaffoldRaw } = await inquirer.prompt([
    {
      type: 'input',
      name: 'scaffoldRaw',
      message: messages.APP_SCAFFOLD_FEATURE_CONFIRM(soleFeatureLabel()) + ' (Y/n)',
      default: 'y',
      validate: validateYesNo,
    },
  ]);
  const val = String(scaffoldRaw).toLowerCase().trim();
  return val === '' || val.startsWith('y');
}
