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
