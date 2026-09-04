jest.mock('../../../container', () => ({
  appService: {
    fetchSurfacePointLocations: jest.fn(),
    fetchSurfacePoints: jest.fn(),
  },
}));

import { buildSurfacePointList, resolveUiAppNonInteractive } from '../../../app-types/ui/authoring';
import { appService } from '../../../container';
import { CliError } from '../../../lib/errors';

const mockedFetchLocations = appService.fetchSurfacePointLocations as jest.Mock;
const mockedFetchPoints = appService.fetchSurfacePoints as jest.Mock;

const ROW = {
  extension_point_name: 'contactDetails.headerMenu.action',
  surface_point_name: 'contactDetails.header.menu',
  location_name: 'contactDetails',
  section_name: 'Header',
  component_type: 'menu',
  extension_type_list: ['actionLink'],
  status: 'active',
};

describe('buildSurfacePointList', () => {
  it('builds one entry per row with the CTA fields attached', () => {
    const entries = buildSurfacePointList([ROW as never], {
      contextFor: () => [],
      sizeFor: () => undefined,
      label: 'Open in Acme',
      more_info: '',
      urlField: 'redirect_link' as const,
      url: 'https://example.com/open',
    });

    expect(entries).toEqual([
      {
        surface_point_name: 'contactDetails.header.menu',
        label: 'Open in Acme',
        redirect_link: 'https://example.com/open',
      },
    ]);
  });

  it('dedupes rows by surface_point_name', () => {
    const entries = buildSurfacePointList([ROW as never, ROW as never], {
      contextFor: () => [],
      sizeFor: () => undefined,
      label: 'Open in Acme',
      more_info: '',
      urlField: 'redirect_link' as const,
      url: 'https://example.com/open',
    });

    expect(entries).toHaveLength(1);
  });

  it('includes context and size only when non-empty', () => {
    const entries = buildSurfacePointList([ROW as never], {
      contextFor: () => ['recordId'],
      sizeFor: () => ({ width: '280px' }),
      label: 'Open in Acme',
      more_info: 'See it here',
      urlField: 'redirect_link' as const,
      url: 'https://example.com/open',
    });

    expect(entries[0]).toEqual({
      surface_point_name: 'contactDetails.header.menu',
      context: ['recordId'],
      size: { width: '280px' },
      label: 'Open in Acme',
      more_info: 'See it here',
      redirect_link: 'https://example.com/open',
    });
  });

  // ──────── the layout guard ────────
  // The builder is what actually stamps `layout`, and it stamps whatever row it is handed.
  // The interactive prompt never asks for one on a non-widget slot, so this cannot fire
  // from that flow today — but a caller that resolved its rows differently would otherwise
  // author a block the upload endpoint rejects, and the partner would meet the rule one
  // round trip later, phrased by the server.
  const WIDGET_ROW = {
    ...ROW,
    surface_point_name: 'contactDetails.overview.main',
    extension_point_name: 'contactDetails.overview.widget',
    section_name: 'Overview',
    component_type: 'widget',
    extension_type_list: ['iframeExtension'],
  };
  const iframeFields = (extra: Record<string, unknown>) => ({
    contextFor: () => [],
    sizeFor: () => undefined,
    label: 'Open in Acme',
    more_info: '',
    urlField: 'modal_iframe_url' as const,
    url: 'https://example.com/embed',
    ...extra,
  });

  it('refuses a layout on a row that renders no card, naming the entry', () => {
    expect(() =>
      buildSurfacePointList([ROW as never], iframeFields({ layout: 'inline' }) as never),
    ).toThrow(CliError);
    expect(() =>
      buildSurfacePointList([ROW as never], iframeFields({ layout: 'inline' }) as never),
    ).toThrow(/surface_point_list\["contactDetails\.header\.menu"\]\.layout/);
  });

  it('stamps a layout and a modal size onto a widget row', () => {
    const entries = buildSurfacePointList(
      [WIDGET_ROW as never],
      iframeFields({ layout: 'inline', modal_size: 'small' }) as never,
    );

    expect(entries[0]).toMatchObject({ layout: 'inline', modal_size: 'small' });
  });

  // A modal size is not a card fact — an action slot's menu entry opens a modal too — so
  // it is stamped wherever it is given, unlike the layout above.
  it('stamps a modal size onto a non-widget row', () => {
    const entries = buildSurfacePointList(
      [ROW as never],
      iframeFields({ modal_size: 'medium' }) as never,
    );

    expect(entries[0]).toMatchObject({ modal_size: 'medium' });
  });
});

describe('resolveUiAppNonInteractive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseInput = {
    extensionType: 'actionLink',
    recordPage: 'contactDetails',
    placement: 'contactDetails.header.menu',
    label: 'Open in Acme',
    moreInfo: '',
    url: 'https://example.com/open',
  };

  it('builds a valid UiApp from flag input', async () => {
    mockedFetchLocations.mockResolvedValue(['contactDetails']);
    mockedFetchPoints.mockResolvedValue([ROW]);

    const uiApp = await resolveUiAppNonInteractive(baseInput);

    expect(uiApp).toEqual({
      extension_type: 'actionLink',
      surface_point_list: [
        {
          surface_point_name: 'contactDetails.header.menu',
          label: 'Open in Acme',
          redirect_link: 'https://example.com/open',
        },
      ],
    });
  });

  it('rejects a non-actionLink extension type before any network call', async () => {
    await expect(
      resolveUiAppNonInteractive({ ...baseInput, extensionType: 'iframeExtension' }),
    ).rejects.toThrow(CliError);
    expect(mockedFetchLocations).not.toHaveBeenCalled();
  });

  it('rejects an unknown --record-page and lists the valid ones', async () => {
    mockedFetchLocations.mockResolvedValue(['contactDetails', 'dealDetails']);

    await expect(resolveUiAppNonInteractive({ ...baseInput, recordPage: 'bogus' })).rejects.toThrow(
      'Unknown --record-page "bogus". Valid record pages: contactDetails, dealDetails.',
    );
  });

  it('rejects an unknown --placement and lists the valid ones for that page', async () => {
    mockedFetchLocations.mockResolvedValue(['contactDetails']);
    mockedFetchPoints.mockResolvedValue([ROW]);

    await expect(resolveUiAppNonInteractive({ ...baseInput, placement: 'bogus' })).rejects.toThrow(
      'Unknown --placement "bogus" for record page "contactDetails". Valid placements: contactDetails.header.menu.',
    );
  });

  it('rejects a label over 48 characters via the shared validateUiApp check', async () => {
    mockedFetchLocations.mockResolvedValue(['contactDetails']);
    mockedFetchPoints.mockResolvedValue([ROW]);

    await expect(
      resolveUiAppNonInteractive({ ...baseInput, label: 'x'.repeat(49) }),
    ).rejects.toThrow(CliError);
  });
});
