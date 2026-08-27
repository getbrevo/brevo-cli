import { stripUiAppWireOnlyKeys } from '../../app-types/wire';
import { appTypeById } from '../../app-types';
import type { UiApp } from '../../types';

/**
 * The wire-only key strip, extracted from `app upload` so the scaffold's pull path can
 * sanitize the server's `ui_app` echo through the SAME owner.
 *
 * The extraction is the point. This rule already had to be fixed twice because the upload
 * diff and the write-back each carried their own traversal (`link_target` arriving on the
 * echo, then `extension_point_name` turning up one level down inside an entry). Adding a
 * third consumer with a third traversal would be the same bug a third time.
 */
describe('stripUiAppWireOnlyKeys', () => {
  it('reads its key list from the ui app type rather than a local copy', () => {
    expect(appTypeById('ui').wireOnlyKeys).toEqual(
      expect.arrayContaining(['link_target', 'version', 'extension_point_name']),
    );
  });

  // Per entry since BEX-426, next to the redirect_link it qualifies — so this is the second
  // key the traversal has to reach one level down, not a top-level filter.
  it('strips link_target from inside a surface_point_list entry', () => {
    const stripped = stripUiAppWireOnlyKeys({
      extension_type: 'actionLink',
      surface_point_list: [
        {
          surface_point_name: 'contact-details-header-menu',
          redirect_link: 'https://example.com/open',
          link_target: '_blank',
        },
      ],
    } as UiApp);
    expect(stripped.surface_point_list?.[0]).toEqual({
      surface_point_name: 'contact-details-header-menu',
      redirect_link: 'https://example.com/open',
    });
    expect(stripped.extension_type).toBe('actionLink');
  });

  it('strips the server-managed version from the top level', () => {
    const stripped = stripUiAppWireOnlyKeys({
      extension_type: 'actionLink',
      version: '3',
    } as unknown as UiApp);
    expect(stripped).not.toHaveProperty('version');
  });

  // The one that lives one level down, inside each surface_point_list entry — which is why
  // the traversal has to recurse rather than filter the top-level keys.
  it('strips extension_point_name from inside a surface_point_list entry', () => {
    const stripped = stripUiAppWireOnlyKeys({
      extension_type: 'actionLink',
      surface_point_list: [
        {
          surface_point_name: 'contact-details-header-menu',
          extension_point_name: 'contactDetails.headerMenu.action',
        },
      ],
    } as unknown as UiApp);
    expect(stripped.surface_point_list?.[0]).toEqual({
      surface_point_name: 'contact-details-header-menu',
    });
  });

  it('keeps every authored field untouched', () => {
    const authored = {
      extension_type: 'actionLink',
      label: 'Open in MyApp',
      more_info: 'Sends this contact to MyApp',
      redirect_link: 'https://example.com/action',
      surface_point_list: [
        { surface_point_name: 'contact-details-header-menu', context: ['recordId'] },
        { surface_point_name: 'deal-details-header-menu' },
      ],
    } as unknown as UiApp;
    expect(stripUiAppWireOnlyKeys(authored)).toEqual(authored);
  });

  it('leaves a block with nothing to strip structurally identical', () => {
    const clean = {
      extension_type: 'iframeExtension',
      modal_iframe_url: 'https://example.com/panel',
      surface_point_list: [{ surface_point_name: 'contact-details-widget' }],
    } as unknown as UiApp;
    expect(stripUiAppWireOnlyKeys(clean)).toEqual(clean);
  });

  it('does not mutate the input', () => {
    const input = {
      extension_type: 'actionLink',
      link_target: '_blank',
      surface_point_list: [
        {
          surface_point_name: 'contact-details-header-menu',
          extension_point_name: 'contactDetails.headerMenu.action',
        },
      ],
    } as unknown as UiApp;
    const snapshot = JSON.parse(JSON.stringify(input));
    stripUiAppWireOnlyKeys(input);
    expect(input).toEqual(snapshot);
  });
});
