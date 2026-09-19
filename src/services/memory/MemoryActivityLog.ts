import {createPersistedLog, type LogEntry} from './persistedLog';

export type MemoryActivityEntry = LogEntry;

const log = createPersistedLog('memory.activityLog', 'MemoryActivityLog');

/**
 * A live-ish feed of what the memory graph actually did: a new fact
 * remembered, an existing one updated, episodic mentions consolidated into
 * one belief, a contradiction resolved, stale quarantined nodes purged, the
 * worldview summary refreshed. This is the "checker" for what the model is
 * doing with memory, surfaced in the Memory Explorer screen — a different
 * audience from MemorySweepLog (which is about whether the background
 * scheduler is firing, not what got remembered).
 *
 * Deliberately does NOT log a "recalled" event per memory access —
 * recordNodeAccess fires on every memory that lands in every chat turn's
 * digest, which would flood this feed uselessly. Recall is surfaced
 * separately, live, in the chat UI itself (see useChatSession.ts) rather
 * than persisted here.
 */
export const logMemoryActivity = log.append;
export const getMemoryActivityLog = log.getAll;
export const clearMemoryActivityLog = log.clear;
