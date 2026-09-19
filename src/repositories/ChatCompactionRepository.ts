import {Q} from '@nozbe/watermelondb';
import {database} from '../database';

// Namespaced against the same shared global_settings table every other
// small settings repository (MemorySettingsRepository, etc.) already uses.
const KEY_COMPACTION_ENABLED = 'chat.compactionEnabled';

/**
 * Owns the single setting that gates chat auto-compaction: whether the app
 * is allowed to summarize older messages in a long conversation to keep it
 * going instead of hitting a hard context-full wall. Off by default, same
 * as the memory feature — this fires a background model completion and
 * discards detail from the visible history, so it should be an explicit
 * opt-in rather than a silent default.
 */
class ChatCompactionRepository {
  private async getRaw(key: string): Promise<string | undefined> {
    try {
      const rows = await database.collections
        .get('global_settings')
        .query(Q.where('key', key))
        .fetch();
      return rows.length > 0 ? (rows[0] as any).value : undefined;
    } catch (error) {
      console.error(`ChatCompactionRepository: error reading "${key}":`, error);
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
          await (rows[0] as any).update((record: any) => {
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
      console.error(`ChatCompactionRepository: error writing "${key}":`, error);
    }
  }

  async isCompactionEnabled(): Promise<boolean> {
    const raw = await this.getRaw(KEY_COMPACTION_ENABLED);
    if (!raw) {
      return false;
    }
    try {
      return JSON.parse(raw) === true;
    } catch {
      return false;
    }
  }

  async setCompactionEnabled(enabled: boolean): Promise<void> {
    await this.setRaw(KEY_COMPACTION_ENABLED, JSON.stringify(enabled));
  }
}

export default new ChatCompactionRepository();
export {ChatCompactionRepository};
