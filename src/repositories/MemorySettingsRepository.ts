import {Q} from '@nozbe/watermelondb';
import {database} from '../database';

// Namespaced so these never collide with the ad-hoc keys other repositories
// already store in the same global_settings table (e.g.
// 'newChatCompletionSettings' in ChatSessionRepository).
const KEY_EMBEDDING_MODEL_PATH = 'memory.embeddingModelPath';
const KEY_MEMORY_ENABLED = 'memory.enabled';

/**
 * Owns the two settings that gate the whole memory feature: which GGUF file
 * is the embedding model, and whether memory is turned on at all. Kept as
 * its own small repository rather than folded into ChatSessionRepository —
 * each repository should own its own domain, and this one is meant to grow
 * a real settings screen around it (embedding model picker, on/off toggle)
 * without touching chat-session code at all.
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
}

export default new MemorySettingsRepository();
export {MemorySettingsRepository};
