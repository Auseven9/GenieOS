import memorySweepHeadlessTask from '../MemorySweepHeadlessTask';
import {modelStore} from '../../../store';
import {maybeRunIdleSweep} from '../MemorySweepScheduler';

jest.mock('../MemorySweepScheduler', () => ({
  maybeRunIdleSweep: jest.fn(),
}));

const mockMaybeRunIdleSweep = maybeRunIdleSweep as jest.Mock;

describe('memorySweepHeadlessTask', () => {
  beforeEach(() => {
    mockMaybeRunIdleSweep.mockReset();
  });

  it('waits for modelStore.whenReady before running the sweep', async () => {
    const order: string[] = [];
    let resolveReady: () => void = () => {};
    modelStore.whenReady = new Promise<void>(resolve => {
      resolveReady = resolve;
    });
    mockMaybeRunIdleSweep.mockImplementation(async () => {
      order.push('sweep');
    });

    const taskPromise = memorySweepHeadlessTask();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMaybeRunIdleSweep).not.toHaveBeenCalled();

    order.push('ready');
    resolveReady();
    await taskPromise;

    expect(order).toEqual(['ready', 'sweep']);
  });

  it('runs the sweep once modelStore is already ready', async () => {
    modelStore.whenReady = Promise.resolve();
    mockMaybeRunIdleSweep.mockResolvedValue(undefined);

    await memorySweepHeadlessTask();

    expect(mockMaybeRunIdleSweep).toHaveBeenCalledTimes(1);
  });
});
