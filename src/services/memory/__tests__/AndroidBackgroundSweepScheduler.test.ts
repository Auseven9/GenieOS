const mockSchedule = jest.fn();
const mockCancel = jest.fn();
const mockLogSweepEvent = jest.fn();

function loadWithModule(nativeModule: unknown) {
  let mod!: typeof import('../AndroidBackgroundSweepScheduler');
  jest.isolateModules(() => {
    jest.doMock('../../../specs/NativeMemorySweepScheduler', () => ({
      __esModule: true,
      default: nativeModule,
    }));
    jest.doMock('../MemorySweepLog', () => ({
      logSweepEvent: (...args: any[]) => mockLogSweepEvent(...args),
    }));
    mod = require('../AndroidBackgroundSweepScheduler');
  });
  return mod;
}

describe('AndroidBackgroundSweepScheduler', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSchedule.mockReset();
    mockCancel.mockReset();
    mockLogSweepEvent.mockReset();
    mockLogSweepEvent.mockResolvedValue(undefined);
  });

  it('schedules the periodic sweep with the given interval', async () => {
    mockSchedule.mockResolvedValue(undefined);
    const {scheduleAndroidBackgroundSweep} = loadWithModule({
      schedulePeriodicSweep: mockSchedule,
      cancelPeriodicSweep: mockCancel,
    });

    await scheduleAndroidBackgroundSweep(24);

    expect(mockSchedule).toHaveBeenCalledWith(24);
    expect(mockLogSweepEvent).toHaveBeenCalledWith(
      expect.stringContaining('24h'),
    );
  });

  it('swallows a schedule failure rather than throwing, and logs it', async () => {
    mockSchedule.mockRejectedValue(new Error('native error'));
    const {scheduleAndroidBackgroundSweep} = loadWithModule({
      schedulePeriodicSweep: mockSchedule,
      cancelPeriodicSweep: mockCancel,
    });

    await expect(scheduleAndroidBackgroundSweep(24)).resolves.toBeUndefined();
    expect(mockLogSweepEvent).toHaveBeenCalledWith(
      expect.stringContaining('native error'),
    );
  });

  it('cancels the periodic sweep', async () => {
    mockCancel.mockResolvedValue(undefined);
    const {cancelAndroidBackgroundSweep} = loadWithModule({
      schedulePeriodicSweep: mockSchedule,
      cancelPeriodicSweep: mockCancel,
    });

    await cancelAndroidBackgroundSweep();

    expect(mockCancel).toHaveBeenCalled();
    expect(mockLogSweepEvent).toHaveBeenCalledWith(
      expect.stringContaining('cancelled'),
    );
  });

  it('swallows a cancel failure rather than throwing', async () => {
    mockCancel.mockRejectedValue(new Error('native error'));
    const {cancelAndroidBackgroundSweep} = loadWithModule({
      schedulePeriodicSweep: mockSchedule,
      cancelPeriodicSweep: mockCancel,
    });

    await expect(cancelAndroidBackgroundSweep()).resolves.toBeUndefined();
  });

  it('is a no-op on iOS, where the spec module resolves to null', async () => {
    const {scheduleAndroidBackgroundSweep, cancelAndroidBackgroundSweep} =
      loadWithModule(null);

    await expect(scheduleAndroidBackgroundSweep(24)).resolves.toBeUndefined();
    await expect(cancelAndroidBackgroundSweep()).resolves.toBeUndefined();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockLogSweepEvent).not.toHaveBeenCalled();
  });
});
