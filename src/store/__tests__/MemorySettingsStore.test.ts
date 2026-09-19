import {memorySettingsStore} from '../MemorySettingsStore';
import memorySettingsRepository from '../../repositories/MemorySettingsRepository';
import {
  scheduleAndroidBackgroundSweep,
  cancelAndroidBackgroundSweep,
} from '../../services/memory/AndroidBackgroundSweepScheduler';

// Mirrors HFStore.test.ts's approach: import the real singleton (already
// constructed once at module load, same as production) and mock the
// repository it wraps, rather than constructing fresh instances — the
// repository is auto-mocked by jest/setup.ts's project-wide mock for
// '../src/database', so its own async calls resolve harmlessly during the
// singleton's own constructor-time load.
jest.mock('../../repositories/MemorySettingsRepository');
jest.mock('../../services/memory/AndroidBackgroundSweepScheduler');

const mockScheduleAndroidBackgroundSweep =
  scheduleAndroidBackgroundSweep as jest.Mock;
const mockCancelAndroidBackgroundSweep =
  cancelAndroidBackgroundSweep as jest.Mock;

describe('MemorySettingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    memorySettingsStore.enabled = false;
    memorySettingsStore.embeddingModelPath = undefined;
    memorySettingsStore.idleSweepEnabled = false;
    memorySettingsStore.idleSweepIntervalHours = 24;
    memorySettingsStore.lastSweepAt = undefined;
    memorySettingsStore.sweepNotificationsEnabled = false;
    mockScheduleAndroidBackgroundSweep.mockResolvedValue(undefined);
    mockCancelAndroidBackgroundSweep.mockResolvedValue(undefined);
  });

  it('setIdleSweepEnabled updates observable state and persists', async () => {
    (
      memorySettingsRepository.setIdleSweepEnabled as jest.Mock
    ).mockResolvedValue(undefined);

    await memorySettingsStore.setIdleSweepEnabled(true);

    expect(memorySettingsStore.idleSweepEnabled).toBe(true);
    expect(memorySettingsRepository.setIdleSweepEnabled).toHaveBeenCalledWith(
      true,
    );
  });

  it('setIdleSweepIntervalHours updates observable state and persists', async () => {
    (
      memorySettingsRepository.setIdleSweepIntervalHours as jest.Mock
    ).mockResolvedValue(undefined);

    await memorySettingsStore.setIdleSweepIntervalHours(6);

    expect(memorySettingsStore.idleSweepIntervalHours).toBe(6);
    expect(
      memorySettingsRepository.setIdleSweepIntervalHours,
    ).toHaveBeenCalledWith(6);
  });

  it('reportSweepRan updates lastSweepAt without touching the repository', () => {
    memorySettingsStore.reportSweepRan(1800000000000);

    expect(memorySettingsStore.lastSweepAt).toBe(1800000000000);
    expect(memorySettingsRepository.setLastSweepAt).not.toHaveBeenCalled();
  });

  it('setSweepNotificationsEnabled updates observable state and persists', async () => {
    (
      memorySettingsRepository.setSweepNotificationsEnabled as jest.Mock
    ).mockResolvedValue(undefined);

    await memorySettingsStore.setSweepNotificationsEnabled(true);

    expect(memorySettingsStore.sweepNotificationsEnabled).toBe(true);
    expect(
      memorySettingsRepository.setSweepNotificationsEnabled,
    ).toHaveBeenCalledWith(true);
  });

  it('setEnabled updates observable state and persists', async () => {
    (memorySettingsRepository.setMemoryEnabled as jest.Mock).mockResolvedValue(
      undefined,
    );

    await memorySettingsStore.setEnabled(true);

    expect(memorySettingsStore.enabled).toBe(true);
    expect(memorySettingsRepository.setMemoryEnabled).toHaveBeenCalledWith(
      true,
    );
  });

  describe('Android background sweep syncing', () => {
    it('schedules the background sweep once both enabled and idleSweepEnabled are true', async () => {
      memorySettingsStore.enabled = true;
      (
        memorySettingsRepository.setIdleSweepEnabled as jest.Mock
      ).mockResolvedValue(undefined);

      await memorySettingsStore.setIdleSweepEnabled(true);

      expect(mockScheduleAndroidBackgroundSweep).toHaveBeenCalledWith(24);
      expect(mockCancelAndroidBackgroundSweep).not.toHaveBeenCalled();
    });

    it('cancels the background sweep when idle sweep is turned off', async () => {
      memorySettingsStore.enabled = true;
      memorySettingsStore.idleSweepEnabled = true;
      (
        memorySettingsRepository.setIdleSweepEnabled as jest.Mock
      ).mockResolvedValue(undefined);

      await memorySettingsStore.setIdleSweepEnabled(false);

      expect(mockCancelAndroidBackgroundSweep).toHaveBeenCalled();
      expect(mockScheduleAndroidBackgroundSweep).not.toHaveBeenCalled();
    });

    it('cancels the background sweep when memory itself is turned off', async () => {
      memorySettingsStore.idleSweepEnabled = true;
      (
        memorySettingsRepository.setMemoryEnabled as jest.Mock
      ).mockResolvedValue(undefined);

      await memorySettingsStore.setEnabled(false);

      expect(mockCancelAndroidBackgroundSweep).toHaveBeenCalled();
      expect(mockScheduleAndroidBackgroundSweep).not.toHaveBeenCalled();
    });

    it('re-schedules with the new interval when the interval changes while active', async () => {
      memorySettingsStore.enabled = true;
      memorySettingsStore.idleSweepEnabled = true;
      (
        memorySettingsRepository.setIdleSweepIntervalHours as jest.Mock
      ).mockResolvedValue(undefined);

      await memorySettingsStore.setIdleSweepIntervalHours(168);

      expect(mockScheduleAndroidBackgroundSweep).toHaveBeenCalledWith(168);
    });

    it('does not schedule when memory is off even if idle sweep is nominally on', async () => {
      memorySettingsStore.enabled = false;
      (
        memorySettingsRepository.setIdleSweepEnabled as jest.Mock
      ).mockResolvedValue(undefined);

      await memorySettingsStore.setIdleSweepEnabled(true);

      expect(mockScheduleAndroidBackgroundSweep).not.toHaveBeenCalled();
      expect(mockCancelAndroidBackgroundSweep).toHaveBeenCalled();
    });
  });
});
