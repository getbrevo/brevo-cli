import { canonicalizeUiApp, uiAppEquals } from '../../../app-types/ui/compare';
import { formatPlacementDiffLines, formatPlacementLines } from '../../../app-types/ui/fields';
import type { UiApp } from '../../../types';

/**
 * The block comparison the upload diff and `app install`'s drift check share. The new case
 * (BEX-498) is the per-entry iframe `sandbox`: the server stamps a default on every entry,
 * so it only counts as a difference where the local file authored a value of its own.
 */
const entry = (extra: Record<string, unknown> = {}) => ({
  surface_point_name: 'contactDetails.header.menu',
  label: 'View in CRM',
  iframe_href: 'https://example.com/embed',
  ...extra,
});
const block = (e: Record<string, unknown>[]) =>
  ({ extension_type: 'iframeExtension', surface_point_list: e }) as unknown as UiApp;

describe('uiAppEquals — per-entry sandbox', () => {
  const DEFAULT = 'allow-scripts allow-same-origin';

  it('treats the server-stamped default as no difference when the file authored none', () => {
    expect(uiAppEquals(block([entry()]), block([entry({ sandbox: DEFAULT })]))).toBe(true);
  });

  it('treats an authored value that differs from the server copy as a change', () => {
    expect(
      uiAppEquals(
        block([entry({ sandbox: `${DEFAULT} allow-forms` })]),
        block([entry({ sandbox: DEFAULT })]),
      ),
    ).toBe(false);
  });

  it('treats an authored value the server does not echo as a change', () => {
    expect(uiAppEquals(block([entry({ sandbox: DEFAULT })]), block([entry()]))).toBe(false);
  });

  it('ignores token order and repeats within one policy', () => {
    expect(
      uiAppEquals(
        block([entry({ sandbox: 'allow-forms allow-scripts' })]),
        block([entry({ sandbox: 'allow-scripts  allow-forms' })]),
      ),
    ).toBe(true);
  });

  it('never lets a root sandbox register as a difference', () => {
    const server = { ...block([entry()]), sandbox: DEFAULT } as unknown as UiApp;
    expect(uiAppEquals(block([entry()]), server)).toBe(true);
  });

  it('canonicalizes a block against itself to keep its own sandbox', () => {
    const local = block([entry({ sandbox: 'allow-forms allow-scripts' })]);
    expect(canonicalizeUiApp(local, local)).toContain('"sandbox":"allow-forms allow-scripts"');
    expect(canonicalizeUiApp(local)).not.toContain('sandbox');
  });
});

describe('placement lines — sandbox row', () => {
  it('prints an authored sandbox under its placement', () => {
    const lines = formatPlacementLines(block([entry({ sandbox: 'allow-scripts allow-forms' })]));
    expect(lines).toContain('  sandbox:       allow-scripts allow-forms');
  });

  it('prints nothing for an entry without one', () => {
    expect(formatPlacementLines(block([entry()])).join('\n')).not.toContain('sandbox');
  });

  it('renders a changed sandbox as before → after', () => {
    const lines = formatPlacementDiffLines(
      block([entry({ sandbox: 'allow-scripts allow-forms' })]),
      block([entry({ sandbox: 'allow-scripts' })]),
    );
    expect(lines).toContain('  sandbox:       allow-scripts → allow-scripts allow-forms');
  });
});
