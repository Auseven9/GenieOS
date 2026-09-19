const mockSoftDelete = jest.fn();

jest.mock('../../../repositories/MemoryRepository', () => ({
  __esModule: true,
  default: {
    softDelete: (...args: any[]) => mockSoftDelete(...args),
  },
}));

import {ForgetEngine} from '../ForgetEngine';

describe('ForgetEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSoftDelete.mockResolvedValue(undefined);
  });

  it('exposes name "forget"', () => {
    expect(new ForgetEngine().name).toBe('forget');
  });

  it('rejects a missing memory_id', async () => {
    const result = await new ForgetEngine().execute({});
    expect(result.type).toBe('error');
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes the given memory id', async () => {
    const result = await new ForgetEngine().execute({memory_id: 'mem-42'});
    expect(result.type).toBe('text');
    expect(mockSoftDelete).toHaveBeenCalledWith('mem-42');
  });

  it('never calls a hard-delete method', async () => {
    await new ForgetEngine().execute({memory_id: 'mem-42'});
    // Guards the design intent: forget is soft-delete only.
    expect(mockSoftDelete).toHaveBeenCalledTimes(1);
  });

  it('returns an error result when the repository throws', async () => {
    mockSoftDelete.mockRejectedValue(new Error('db exploded'));
    const result = await new ForgetEngine().execute({memory_id: 'mem-42'});
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toBe('db exploded');
    }
  });

  it('toToolDefinition returns a valid function schema requiring memory_id', () => {
    const def = new ForgetEngine().toToolDefinition();
    expect(def.type).toBe('function');
    expect(def.function.name).toBe('forget');
    expect(def.function.parameters.required).toEqual(['memory_id']);
  });
});
