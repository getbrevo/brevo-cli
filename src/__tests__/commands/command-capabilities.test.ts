import { appCommandGroup } from '../../commands/definitions';
import { capabilitiesFor, type Capability, type Distribution } from '../../app-types/capabilities';
import type { AppTypeId } from '../../app-types/contract';

const TYPES: AppTypeId[] = ['oauth', 'ui'];
const DISTRIBUTIONS: Distribution[] = ['private', 'public'];

const ALL_CAPABILITIES = new Set<Capability>(
  TYPES.flatMap((type) => DISTRIBUTIONS.flatMap((dist) => [...capabilitiesFor(type, dist)])),
);

const gated = appCommandGroup.commands.filter((cmd) => cmd.requires);

describe('command capability metadata', () => {
  // The point of the field: the rule "review commands are public-only, deploy commands are
  // UI-only" currently also exists as prose in bin/index.ts's hand-aligned help block and
  // again in the agent docs. This is the executable copy, so the others can be generated
  // from it rather than drifting.
  it('declares the expected gates and no others', () => {
    const byName = Object.fromEntries(gated.map((cmd) => [cmd.name, cmd.requires]));
    expect(byName).toEqual({
      deploy: 'account-install',
      rollback: 'account-install',
      submit: 'review-lifecycle',
      status: 'review-lifecycle',
      withdraw: 'review-lifecycle',
    });
  });

  it('only names capabilities the matrix actually grants somewhere', () => {
    for (const cmd of gated) {
      expect(ALL_CAPABILITIES.has(cmd.requires!)).toBe(true);
    }
  });

  // An unreachable gate would be a command no app could ever run. Every declared capability
  // must be satisfiable by at least one (type, distribution) combination.
  it('declares no gate that no app can satisfy', () => {
    for (const cmd of gated) {
      const reachable = TYPES.some((type) =>
        DISTRIBUTIONS.some((dist) => capabilitiesFor(type, dist).includes(cmd.requires!)),
      );
      expect(reachable).toBe(true);
    }
  });

  // Guards against the metadata being added and then quietly reinterpreted as enforcement.
  // The registry must not gate anything at runtime: each command throws its own tested
  // message via assertCapability, and a generic interceptor would replace them all.
  it('leaves ungated commands ungated', () => {
    const ungated = appCommandGroup.commands.filter((cmd) => !cmd.requires).map((c) => c.name);
    expect(ungated).toContain('create');
    expect(ungated).toContain('list');
    expect(ungated).toContain('upload');
    expect(ungated).toContain('delete');
    expect(ungated).toContain('scaffold');
  });
});
