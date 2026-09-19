import memorySweepHeadlessTask from '../MemorySweepHeadlessTask';
import {modelStore} from '../../../store';
import {maybeRunIdleSweep} from '../MemorySweepScheduler';
import {logSweepEvent} from '../MemorySweepLog';

jest.mock('../MemorySweepScheduler', () => ({
  maybeRunIdleSweep: jest.fn(),
}));

jest.mock('../MemorySweepLog', () => ({
  logSweepEvent: jest.fn(),
}));

const mockMaybeRunIdleSweep = maybeRunIdleSweep as jest.Mock;
const mockLogSweepEvent = logSweepEvent as jest.Mock;

describe('memorySweepHeadlessTask', () => {
  beforeEach(() => {
    mockMaybeRunIdleSweep.mockReset();
    mockLogSweepEvent.mockReset();
    mockLogSweepEvent.mockResolvedValue(undefined);
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

  it('runs the sweep once modelStore is already ready, passing source=background', async () => {
    modelStore.whenReady = Promise.resolve();
    mockMaybeRunIdleSweep.mockResolvedValue(undefined);

    await memorySweepHeadlessTask();

    expect(mockMaybeRunIdleSweep).toHaveBeenCalledWith('background');
  });

  it('logs invocation before waiting on modelStore, and completion after the sweep', async () => {
    const order: string[] = [];
    mockLogSweepEvent.mockImplementation(async (message: string) => {
      order.push(message);
    });
    let resolveReady: () => void = () => {};
    modelStore.whenReady = new Promise<void>(resolve => {
      resolveReady = resolve;
    });
    mockMaybeRunIdleSweep.mockImplementation(async () => {
      order.push('sweep ran');
    });

    const taskPromise = memorySweepHeadlessTask();
    await Promise.resolve();
    await Promise.resolve();
    resolveReady();
    await taskPromise;

    expect(order).toEqual([
      'Android headless task invoked',
      'sweep ran',
      'Android headless task finished',
    ]);
  });
});
