import { normalizeAppId } from '../../services/normalize-app-id';
import { CliError } from '../../lib/errors';

describe('normalizeAppId', () => {
  it('coerces numeric app_id to string', () => {
    const out = normalizeAppId({ app_id: 42, name: 'x' });
    expect(out.app_id).toBe('42');
    expect(out.name).toBe('x');
  });

  it('passes string app_id through unchanged', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const out = normalizeAppId({ app_id: uuid });
    expect(out.app_id).toBe(uuid);
  });

  it('trims surrounding whitespace on string app_id', () => {
    const out = normalizeAppId({ app_id: '  abc-123  ' });
    expect(out.app_id).toBe('abc-123');
  });

  it.each([
    ['empty string', ''],
    ['whitespace-only', '   '],
    ['tab/newline-only', '\t\n'],
  ])('throws CliError when app_id is %s', (_label, value) => {
    expect(() => normalizeAppId({ app_id: value })).toThrow(CliError);
    expect(() => normalizeAppId({ app_id: value })).toThrow(/non-empty string/);
  });

  it('preserves other fields', () => {
    const out = normalizeAppId({ app_id: 1, name: 'n', client_id: 'c' });
    expect(out).toEqual({ app_id: '1', name: 'n', client_id: 'c' });
  });

  const invalidCases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['object', { foo: 'bar' }],
    ['array', [1, 2]],
    ['boolean', true],
    ['NaN', Number.NaN],
  ];
  it.each(invalidCases)('throws CliError when app_id is %s', (_label, value) => {
    expect(() => normalizeAppId({ app_id: value })).toThrow(CliError);
  });

  it('distinguishes NaN in the error message', () => {
    expect(() => normalizeAppId({ app_id: Number.NaN })).toThrow(/number \(NaN\)/);
  });

  it('distinguishes Infinity in the error message', () => {
    expect(() => normalizeAppId({ app_id: Number.POSITIVE_INFINITY })).toThrow(
      /number \(Infinity\)/,
    );
    expect(() => normalizeAppId({ app_id: Number.NEGATIVE_INFINITY })).toThrow(
      /number \(-Infinity\)/,
    );
  });
});
