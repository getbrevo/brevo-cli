import { readHiddenInput } from '../../lib/hidden-input';

describe('readHiddenInput', () => {
  it('should resolve with trimmed input', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Mock stdin to emit data
    const originalEmit = process.stdin.emit.bind(process.stdin);
    const promise = readHiddenInput('Enter key: ');

    // Simulate user typing and pressing enter via stdin
    process.nextTick(() => {
      originalEmit('data', '  my-secret-key  \n');
    });

    const result = await promise;
    expect(result).toBe('my-secret-key');

    writeSpy.mockRestore();
  });
});
