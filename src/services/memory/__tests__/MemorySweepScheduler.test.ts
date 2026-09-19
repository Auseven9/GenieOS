import {AppState} from 'react-native';

const mockAddEventListener = jest.fn().mockReturnValue({remove: jest.fn()});
jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation(mockAddEventListener);

const mockIsMemoryEnabled = jest.fn();
const mockIsIdleSweepEnabled = jest.fn();
const mockGetIdleSweepIntervalHours = jest.fn();
const mockGetLastSweepAt = jest.fn();
const mockGetEmbeddingModelPath = jest.fn();
const mockSetLastSweepAt = jest.fn();

jest.mock('../../../repositories/MemorySettingsRepository', () => ({
  __esModule: true,
  default: {
    isMemoryEnabled: (...args: any[]) => mockIsMemoryEnabled(...args),
    isIdleSweepEnabled: (...args: any[]) => mockIsIdleSweepEnabled(...args),
    getIdleSweepIntervalHours: (...args: any[]) =>
      mockGetIdleSweepIntervalHours(...args),
    getLastSweepAt: (...args: any[]) => mockGetLastSweepAt(...args),
    getEmbeddingModelPath: (...args: any[]) =>
      mockGetEmbeddingModelPath(...args),
    setLastSweepAt: (...args: any[]) => mockSetLastSweepAt(...args),
  },
}));

const mockReportSweepRan = jest.fn();
jest.mock('../../../store', () => ({
  chatSessionStore: {isGenerating: false},
  memorySettingsStore: {
    reportSweepRan: (...args: any[]) => mockReportSweepRan(...args),
    sweepNotificationsEnabled: false,
  },
}));

const mockRunMemorySweep = jest.fn();
jest.mock('../MemorySweepPipeline', () => ({
  runMemorySweep: (...args: any[]) => mockRunMemorySweep(...args),
}));

const mockNotifySweepComplete = jest.fn();
jest.mock('../../notifications/SweepNotificationService', () => ({
  notifySweepComplete: (...args: any[]) => mockNotifySweepComplete(...args),
}));

const mockScheduleAndroidBackgroundSweep = jest.fn();
const mockCancelAndroidBackgroundSweep = jest.fn();
jest.mock('../AndroidBackgroundSweepScheduler', () => ({
  scheduleAndroidBackgroundSweep: (...args: any[]) =>
    mockScheduleAndroidBackgroundSweep(...args),
  cancelAndroidBackgroundSweep: (...args: any[]) =>
    mockCancelAndroidBackgroundSweep(...args),
}));

import {
  maybeRunIdleSweep,
  forceRunIdleSweep,
  initMemorySweepScheduler,
} from '../MemorySweepScheduler';
import {chatSessionStore, memorySettingsStore} from '../../../store';

describe('maybeRunIdleSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).isGenerating = false;
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockIsIdleSweepEnabled.mockResolvedValue(true);
    mockGetIdleSweepIntervalHours.mockResolvedValue(24);
    mockGetLastSweepAt.mockResolvedValue(Date.now() - 25 * 60 * 60 * 1000);
    mockGetEmbeddingModelPath.mockResolvedValue('/models/bge-small.gguf');
    mockRunMemorySweep.mockResolvedValue(undefined);
    (memorySettingsStore as any).sweepNotificationsEnabled = false;
    mockNotifySweepComplete.mockResolvedValue(undefined);
  });

  it('does nothing when memory is disabled', async () => {
    mockIsMemoryEnabled.mockResolvedValue(false);
    await maybeRunIdleSweep();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });

  it('does nothing when idle sweep is disabled', async () => {
    mockIsIdleSweepEnabled.mockResolvedValue(false);
    await maybeRunIdleSweep();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });

  it('does nothing while the visible turn is generating', async () => {
    (chatSessionStore as any).isGenerating = true;
    await maybeRunIdleSweep();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });

  it('does nothing when not yet due', async () => {
    mockGetLastSweepAt.mockResolvedValue(Date.now() - 1000);
    await maybeRunIdleSweep();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });

  it('runs immediately when a sweep has never run before', async () => {
    mockGetLastSweepAt.mockResolvedValue(undefined);
    await maybeRunIdleSweep();
    expect(mockRunMemorySweep).toHaveBeenCalledWith('/models/bge-small.gguf');
  });

  it('runs when the interval has elapsed, recording the attempt before running', async () => {
    await maybeRunIdleSweep();

    expect(mockSetLastSweepAt).toHaveBeenCalledWith(expect.any(Number));
    expect(mockReportSweepRan).toHaveBeenCalledWith(expect.any(Number));
    expect(mockRunMemorySweep).toHaveBeenCalledWith('/models/bge-small.gguf');
  });

  it('records the attempt even when the sweep itself throws', async () => {
    mockRunMemorySweep.mockRejectedValue(new Error('sweep exploded'));
    await expect(maybeRunIdleSweep()).resolves.toBeUndefined();
    expect(mockSetLastSweepAt).toHaveBeenCalled();
  });

  it('does not notify when sweep-notifications is off', async () => {
    (memorySettingsStore as any).sweepNotificationsEnabled = false;
    await maybeRunIdleSweep();
    expect(mockNotifySweepComplete).not.toHaveBeenCalled();
  });

  it('notifies after a successful sweep when sweep-notifications is on', async () => {
    (memorySettingsStore as any).sweepNotificationsEnabled = true;
    await maybeRunIdleSweep();
    expect(mockNotifySweepComplete).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the sweep itself throws, even with notifications on', async () => {
    (memorySettingsStore as any).sweepNotificationsEnabled = true;
    mockRunMemorySweep.mockRejectedValue(new Error('sweep exploded'));
    await maybeRunIdleSweep();
    expect(mockNotifySweepComplete).not.toHaveBeenCalled();
  });

  it('swallows an error from a settings check rather than throwing', async () => {
    mockIsMemoryEnabled.mockRejectedValue(new Error('db exploded'));
    await expect(maybeRunIdleSweep()).resolves.toBeUndefined();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });
});

describe('forceRunIdleSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).isGenerating = false;
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockIsIdleSweepEnabled.mockResolvedValue(true);
    mockGetIdleSweepIntervalHours.mockResolvedValue(24);
    mockGetEmbeddingModelPath.mockResolvedValue(undefined);
    mockRunMemorySweep.mockResolvedValue(undefined);
  });

  it('runs even when the interval has not elapsed yet', async () => {
    mockGetLastSweepAt.mockResolvedValue(Date.now());
    await forceRunIdleSweep();
    expect(mockRunMemorySweep).toHaveBeenCalled();
  });

  it('still respects the memory-enabled gate', async () => {
    mockIsMemoryEnabled.mockResolvedValue(false);
    await forceRunIdleSweep();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });

  it('still respects the isGenerating gate', async () => {
    (chatSessionStore as any).isGenerating = true;
    await forceRunIdleSweep();
    expect(mockRunMemorySweep).not.toHaveBeenCalled();
  });
});

describe('initMemorySweepScheduler', () => {
  // initMemorySweepScheduler() is idempotent by design (see the module's
  // own `initialized` guard), so it's only meaningful to call once across
  // this whole describe block — the registered handler is captured here
  // and reused by every test below, rather than re-extracted from
  // mockAddEventListener.mock.calls (which jest.clearAllMocks resets).
  let handler: (state: string) => void;

  beforeAll(() => {
    initMemorySweepScheduler();
    handler = mockAddEventListener.mock.calls[0][1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).isGenerating = false;
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockIsIdleSweepEnabled.mockResolvedValue(true);
    mockGetIdleSweepIntervalHours.mockResolvedValue(24);
    mockGetLastSweepAt.mockResolvedValue(undefined);
    mockGetEmbeddingModelPath.mockResolvedValue(undefined);
    mockRunMemorySweep.mockResolvedValue(undefined);
  });

  it('registers the AppState listener exactly once, even if called again', () => {
    initMemorySweepScheduler();
    initMemorySweepScheduler();

    expect(mockAddEventListener).not.toHaveBeenCalled();
  });

  it('checks for a due sweep on an inactive/background to active transition', async () => {
    handler('background');
    handler('active');
    await new Promise(resolve => setImmediate(resolve));

    expect(mockIsMemoryEnabled).toHaveBeenCalled();
  });

  it('does not check on an active to background transition', async () => {
    // Force a known starting state rather than relying on whatever the
    // previous test left the module's internal appState in.
    handler('active');
    mockIsMemoryEnabled.mockClear();
    handler('background');
    await new Promise(resolve => setImmediate(resolve));

    expect(mockIsMemoryEnabled).not.toHaveBeenCalled();
  });
});

describe('reconcileAndroidBackgroundSweep (via a fresh initMemorySweepScheduler cold start)', () => {
  // A fresh module instance each time, so the module-level `initialized`
  // guard doesn't swallow these calls the way it would across the shared
  // describe block above.
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAddEventListener.mockReturnValue({remove: jest.fn()});
    mockGetEmbeddingModelPath.mockResolvedValue(undefined);
    mockGetLastSweepAt.mockResolvedValue(undefined);
    mockRunMemorySweep.mockResolvedValue(undefined);
  });

  it('schedules the Android background sweep when memory and idle sweep are both enabled', async () => {
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockIsIdleSweepEnabled.mockResolvedValue(true);
    mockGetIdleSweepIntervalHours.mockResolvedValue(72);

    const fresh = require('../MemorySweepScheduler');
    fresh.initMemorySweepScheduler();
    await new Promise(resolve => setImmediate(resolve));

    expect(mockScheduleAndroidBackgroundSweep).toHaveBeenCalledWith(72);
    expect(mockCancelAndroidBackgroundSweep).not.toHaveBeenCalled();
  });

  it('cancels the Android background sweep when idle sweep is disabled', async () => {
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockIsIdleSweepEnabled.mockResolvedValue(false);
    mockGetIdleSweepIntervalHours.mockResolvedValue(24);

    const fresh = require('../MemorySweepScheduler');
    fresh.initMemorySweepScheduler();
    await new Promise(resolve => setImmediate(resolve));

    expect(mockCancelAndroidBackgroundSweep).toHaveBeenCalled();
    expect(mockScheduleAndroidBackgroundSweep).not.toHaveBeenCalled();
  });

  it('cancels the Android background sweep when memory itself is disabled', async () => {
    mockIsMemoryEnabled.mockResolvedValue(false);
    mockIsIdleSweepEnabled.mockResolvedValue(true);
    mockGetIdleSweepIntervalHours.mockResolvedValue(24);

    const fresh = require('../MemorySweepScheduler');
    fresh.initMemorySweepScheduler();
    await new Promise(resolve => setImmediate(resolve));

    expect(mockCancelAndroidBackgroundSweep).toHaveBeenCalled();
    expect(mockScheduleAndroidBackgroundSweep).not.toHaveBeenCalled();
  });
});
