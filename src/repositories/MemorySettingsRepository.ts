import {Q} from '@nozbe/watermelondb';
import {database} from '../database';

// Namespaced so these never collide with the ad-hoc keys other repositories
// already store in the same global_settings table (e.g.
// 'newChatCompletionSettings' in ChatSessionRepository).
const KEY_EMBEDDING_MODEL_PATH = 'memory.embeddingModelPath';
const KEY_MEMORY_ENABLED = 'memory.enabled';
const KEY_IDLE_SWEEP_ENABLED = 'memory.idleSweepEnabled';
const KEY_IDLE_SWEEP_INTERVAL_HOURS = 'memory.idleSweepIntervalHours';
const KEY_LAST_SWEEP_AT = 'memory.lastSweepAt';
const KEY_SWEEP_NOTIFICATIONS_ENABLED = 'memory.sweepNotificationsEnabled';

// Presets rather than a free-typed number: there's no OS-level background
// scheduler backing this (see MemorySweepScheduler), so the real interval a
// user gets is "whenever the app is next foregrounded after this much time
// has passed" — a small, honest set of choices fits that better than a
// precision the mechanism can't actually deliver.
export const IDLE_SWEEP_INTERVAL_HOURS_OPTIONS = [6, 24, 72, 168] as const;
export type IdleSweepIntervalHours =
  (typeof IDLE_SWEEP_INTERVAL_HOURS_OPTIONS)[number];
const DEFAULT_IDLE_SWEEP_INTERVAL_HOURS: IdleSweepIntervalHours = 24;

/**
 * Owns every setting that gates the memory feature: which GGUF file is the
 * embedding model, whether memory is turned on at all, and the idle-sweep
 * schedule (on/off, interval, last-run timestamp). Kept as its own small
 * repository rather than folded into ChatSessionRepository — each
 * repository should own its own domain, and this one grows a real settings
 * screen around it without touching chat-session code at all.
 */
class MemorySettingsRepository {
  private async getRaw(key: string): Promise<string | undefined> {
    try {
      const rows = await database.collections
        .get('global_settings')
        .query(Q.where('key', key))
        .fetch();
      return rows.length > 0 ? (rows[0] as any).value : undefined;
    } catch (error) {
      console.error(`MemorySettingsRepository: error reading "${key}":`, error);
      return undefined;
    }
  }

  private async setRaw(key: string, value: string): Promise<void> {
    try {
      await database.write(async () => {
        const rows = await database.collections
          .get('global_settings')
          .query(Q.where('key', key))
          .fetch();
        if (rows.length > 0) {
          await rows[0].update((record: any) => {
            record.value = value;
          });
        } else {
          await database.collections
            .get('global_settings')
            .create((record: any) => {
              record.key = key;
              record.value = value;
            });
        }
      });
    } catch (error) {
      console.error(`MemorySettingsRepository: error writing "${key}":`, error);
    }
  }

  /** Undefined until the user has picked a file in settings. */
  async getEmbeddingModelPath(): Promise<string | undefined> {
    const raw = await this.getRaw(KEY_EMBEDDING_MODEL_PATH);
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async setEmbeddingModelPath(path: string | undefined): Promise<void> {
    await this.setRaw(KEY_EMBEDDING_MODEL_PATH, JSON.stringify(path ?? null));
  }

  /** Off by default: memory is opt-in, never silently active. */
  async isMemoryEnabled(): Promise<boolean> {
    const raw = await this.getRaw(KEY_MEMORY_ENABLED);
    if (!raw) {
      return false;
    }
    try {
      return JSON.parse(raw) === true;
    } catch {
      return false;
    }
  }

  async setMemoryEnabled(enabled: boolean): Promise<void> {
    await this.setRaw(KEY_MEMORY_ENABLED, JSON.stringify(enabled));
  }

  /** Off by default, and meaningless while memory itself is off. */
  async isIdleSweepEnabled(): Promise<boolean> {
    const raw = await this.getRaw(KEY_IDLE_SWEEP_ENABLED);
    if (!raw) {
      return false;
    }
    try {
      return JSON.parse(raw) === true;
    } catch {
      return false;
    }
  }

  async setIdleSweepEnabled(enabled: boolean): Promise<void> {
    await this.setRaw(KEY_IDLE_SWEEP_ENABLED, JSON.stringify(enabled));
  }

  async getIdleSweepIntervalHours(): Promise<IdleSweepIntervalHours> {
    const raw = await this.getRaw(KEY_IDLE_SWEEP_INTERVAL_HOURS);
    if (!raw) {
      return DEFAULT_IDLE_SWEEP_INTERVAL_HOURS;
    }
    try {
      const parsed = JSON.parse(raw);
      return IDLE_SWEEP_INTERVAL_HOURS_OPTIONS.includes(parsed)
        ? parsed
        : DEFAULT_IDLE_SWEEP_INTERVAL_HOURS;
    } catch {
      return DEFAULT_IDLE_SWEEP_INTERVAL_HOURS;
    }
  }

  async setIdleSweepIntervalHours(
    hours: IdleSweepIntervalHours,
  ): Promise<void> {
    await this.setRaw(KEY_IDLE_SWEEP_INTERVAL_HOURS, JSON.stringify(hours));
  }

  /** Undefined until the first sweep has ever run. */
  async getLastSweepAt(): Promise<number | undefined> {
    const raw = await this.getRaw(KEY_LAST_SWEEP_AT);
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'number' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async setLastSweepAt(epochMs: number): Promise<void> {
    await this.setRaw(KEY_LAST_SWEEP_AT, JSON.stringify(epochMs));
  }

  /** Off by default — notifications are opt-in on top of idle sweeps
   * already being opt-in, and enabling this is gated on the OS actually
   * granting notification permission (see SweepNotificationService). */
  async isSweepNotificationsEnabled(): Promise<boolean> {
    const raw = await this.getRaw(KEY_SWEEP_NOTIFICATIONS_ENABLED);
    if (!raw) {
      return false;
    }
    try {
      return JSON.parse(raw) === true;
    } catch {
      return false;
    }
  }

  async setSweepNotificationsEnabled(enabled: boolean): Promise<void> {
    await this.setRaw(KEY_SWEEP_NOTIFICATIONS_ENABLED, JSON.stringify(enabled));
  }
}

export default new MemorySettingsRepository();
export {MemorySettingsRepository};
