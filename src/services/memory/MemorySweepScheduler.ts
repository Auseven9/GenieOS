import {AppState, type AppStateStatus} from 'react-native';
import {chatSessionStore, memorySettingsStore} from '../../store';
import memorySettingsRepository from '../../repositories/MemorySettingsRepository';
import {runMemorySweep} from './MemorySweepPipeline';

/**
 * Decides *when* an idle sweep should run. There is no OS-level background
 * scheduler backing this (React Native has none without a native module
 * this app doesn't have) — the honest mechanism available is "check when
 * the app comes back to the foreground, gated by how long it's been since
 * the last sweep," the same pattern ServerStore already uses for its own
 * foreground refetch-throttling. A sweep genuinely due while the app stays
 * backgrounded runs the next time it's opened, not on a timer while
 * backgrounded.
 */

async function runIfDue(options: {ignoreInterval: boolean}): Promise<void> {
  try {
    const [memoryEnabled, idleSweepEnabled] = await Promise.all([
      memorySettingsRepository.isMemoryEnabled(),
      memorySettingsRepository.isIdleSweepEnabled(),
    ]);
    if (!memoryEnabled || !idleSweepEnabled) {
      return;
    }
    // Never compete with the visible turn's own completion() call.
    if (chatSessionStore.isGenerating) {
      return;
    }

    const [intervalHours, lastSweepAt, embeddingModelPath] = await Promise.all([
      memorySettingsRepository.getIdleSweepIntervalHours(),
      memorySettingsRepository.getLastSweepAt(),
      memorySettingsRepository.getEmbeddingModelPath(),
    ]);
    const dueAt = (lastSweepAt ?? 0) + intervalHours * 60 * 60 * 1000;
    if (!options.ignoreInterval && Date.now() < dueAt) {
      return;
    }

    // Recorded before the sweep runs, not after: a sweep that throws
    // partway through still counts as "attempted around now," so a
    // failing step can't retry-storm on every subsequent foreground event.
    const startedAt = Date.now();
    await memorySettingsRepository.setLastSweepAt(startedAt);
    memorySettingsStore.reportSweepRan(startedAt);

    await runMemorySweep(embeddingModelPath);
  } catch (error) {
    console.error('MemorySweepScheduler: idle sweep check failed:', error);
  }
}

async function maybeRunIdleSweep(): Promise<void> {
  await runIfDue({ignoreInterval: false});
}

/**
 * Runs a sweep right now, bypassing the interval check — the settings
 * screen's manual "Sweep now" button. Still respects the same safety
 * gates as the automatic check (memory/idle-sweep must be enabled, and
 * never while the visible turn is generating).
 */
async function forceRunIdleSweep(): Promise<void> {
  await runIfDue({ignoreInterval: true});
}

let appState: AppStateStatus = AppState.currentState;

function handleAppStateChange(nextAppState: AppStateStatus) {
  if (appState !== 'active' && nextAppState === 'active') {
    maybeRunIdleSweep().catch(() => {});
  }
  appState = nextAppState;
}

let initialized = false;

/**
 * Registers the foreground-transition check once for the app's lifetime.
 * Idempotent — safe to call from an effect that could run more than once
 * (e.g. React StrictMode's double-invoked effects in development).
 */
export function initMemorySweepScheduler(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  AppState.addEventListener('change', handleAppStateChange);
  // Cold start counts as "the user just arrived" too — otherwise a sweep
  // would never fire until the user backgrounds and reopens the app at
  // least once after enabling it.
  maybeRunIdleSweep().catch(() => {});
}

export {maybeRunIdleSweep, forceRunIdleSweep};
