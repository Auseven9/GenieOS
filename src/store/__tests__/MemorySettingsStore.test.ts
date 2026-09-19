import {memorySettingsStore} from '../MemorySettingsStore';
import memorySettingsRepository from '../../repositories/MemorySettingsRepository';

// Mirrors HFStore.test.ts's approach: import the real singleton (already
// constructed once at module load, same as production) and mock the
// repository it wraps, rather than constructing fresh instances — the
// repository is auto-mocked by jest/setup.ts's project-wide mock for
// '../src/database', so its own async calls resolve harmlessly during the
// singleton's own constructor-time load.
jest.mock('../../repositories/MemorySettingsRepository');

describe('MemorySettingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    memorySettingsStore.enabled = false;
    memorySettingsStore.embeddingModelPath = undefined;
    memorySettingsStore.idleSweepEnabled = false;
    memorySettingsStore.idleSweepIntervalHours = 24;
    memorySettingsStore.lastSweepAt = undefined;
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
});
