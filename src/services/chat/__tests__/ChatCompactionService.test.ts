const mockIsCompactionEnabled = jest.fn();
const mockGetSessionById = jest.fn();
const mockAddMessageToSession = jest.fn();
const mockCreateExtractionCompletionFn = jest.fn();
const mockUpdateMessage = jest.fn();
const mockAddMessageToCurrentSession = jest.fn();

jest.mock('../../../repositories/ChatCompactionRepository', () => ({
  __esModule: true,
  default: {
    isCompactionEnabled: (...args: any[]) => mockIsCompactionEnabled(...args),
  },
}));

jest.mock('../../../repositories/ChatSessionRepository', () => ({
  chatSessionRepository: {
    getSessionById: (...args: any[]) => mockGetSessionById(...args),
    addMessageToSession: (...args: any[]) => mockAddMessageToSession(...args),
  },
}));

jest.mock('../../memory/extractionModel', () => ({
  createExtractionCompletionFn: (...args: any[]) =>
    mockCreateExtractionCompletionFn(...args),
}));

jest.mock('../../../store', () => ({
  chatSessionStore: {
    isGenerating: false,
    lastCompletionResult: undefined,
    activeSessionId: 'session-1',
    updateMessage: (...args: any[]) => mockUpdateMessage(...args),
    addMessageToCurrentSession: (...args: any[]) =>
      mockAddMessageToCurrentSession(...args),
  },
  modelStore: {
    activeModelCaps: {effectiveContextLength: undefined},
  },
}));

import {maybeCompactSession} from '../ChatCompactionService';
import {chatSessionStore, modelStore} from '../../../store';

function makeMessage(overrides: Record<string, any> = {}) {
  const base = {
    id: 'msg-default',
    type: 'text',
    text: 'hello',
    author: {id: 'y9d7f8pgn'},
    createdAt: Date.now(),
    metadata: {},
    ...overrides,
  };
  return {toMessageObject: () => base};
}

function manyUserMessages(count: number, startId = 0) {
  return Array.from({length: count}, (_, i) =>
    makeMessage({
      id: `msg-${startId + i}`,
      text: `message ${startId + i}`,
    }),
  );
}

describe('maybeCompactSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).isGenerating = false;
    (chatSessionStore as any).lastCompletionResult = {
      used: 700,
      contextFull: false,
      isRemote: false,
    };
    (chatSessionStore as any).activeSessionId = 'session-1';
    (modelStore as any).activeModelCaps = {effectiveContextLength: 1000};
    mockIsCompactionEnabled.mockResolvedValue(true);
    mockCreateExtractionCompletionFn.mockResolvedValue({
      complete: jest
        .fn()
        .mockResolvedValue(JSON.stringify({summary: 'a concise summary'})),
      extractedBy: 'draft-model',
    });
    mockUpdateMessage.mockResolvedValue(undefined);
    mockAddMessageToCurrentSession.mockResolvedValue(undefined);
    mockAddMessageToSession.mockResolvedValue({id: 'new-summary'});
  });

  it('does nothing when compaction is disabled', async () => {
    mockIsCompactionEnabled.mockResolvedValue(false);

    await maybeCompactSession('session-1');

    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it('does nothing while the engine is still busy with the triggering turn', async () => {
    (chatSessionStore as any).isGenerating = true;

    await maybeCompactSession('session-1');

    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it('does nothing when the runtime context size is unknown', async () => {
    (modelStore as any).activeModelCaps = {effectiveContextLength: undefined};

    await maybeCompactSession('session-1');

    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it('does nothing when the last turn has not crossed the trigger ratio', async () => {
    (chatSessionStore as any).lastCompletionResult = {
      used: 100,
      contextFull: false,
      isRemote: false,
    };

    await maybeCompactSession('session-1');

    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it('does nothing when there are too few uncompacted messages ahead of the kept tail', async () => {
    mockGetSessionById.mockResolvedValue({
      messages: [...manyUserMessages(6)].reverse(),
    });

    await maybeCompactSession('session-1');

    expect(mockCreateExtractionCompletionFn).not.toHaveBeenCalled();
  });

  it('compacts the eligible range, keeping the most recent messages untouched', async () => {
    // 14 messages total: 8 eligible for compaction, 6 kept as the tail.
    const messages = manyUserMessages(14);
    mockGetSessionById.mockResolvedValue({messages: [...messages].reverse()});

    await maybeCompactSession('session-1');

    expect(mockCreateExtractionCompletionFn).toHaveBeenCalledTimes(1);
    // Only the first 8 (oldest) messages get marked compacted.
    expect(mockUpdateMessage).toHaveBeenCalledTimes(8);
    for (let i = 0; i < 8; i++) {
      expect(mockUpdateMessage).toHaveBeenCalledWith(`msg-${i}`, 'session-1', {
        metadata: {compacted: true},
      });
    }
    for (let i = 8; i < 14; i++) {
      expect(mockUpdateMessage).not.toHaveBeenCalledWith(
        `msg-${i}`,
        'session-1',
        expect.anything(),
      );
    }
  });

  it('appends the summary via the store when compacting the active session', async () => {
    mockGetSessionById.mockResolvedValue({
      messages: [...manyUserMessages(14)].reverse(),
    });

    await maybeCompactSession('session-1');

    expect(mockAddMessageToCurrentSession).toHaveBeenCalledTimes(1);
    const summaryMessage = mockAddMessageToCurrentSession.mock.calls[0][0];
    expect(summaryMessage.text).toContain('a concise summary');
    expect(summaryMessage.metadata).toEqual({
      system: true,
      compactionSummary: true,
    });
    expect(mockAddMessageToSession).not.toHaveBeenCalled();
  });

  it('writes directly via the repository when compacting a session that is not active', async () => {
    (chatSessionStore as any).activeSessionId = 'some-other-session';
    mockGetSessionById.mockResolvedValue({
      messages: [...manyUserMessages(14)].reverse(),
    });

    await maybeCompactSession('session-1');

    expect(mockAddMessageToSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        metadata: {system: true, compactionSummary: true},
      }),
    );
    expect(mockAddMessageToCurrentSession).not.toHaveBeenCalled();
  });

  it('folds a previous live summary into the new one and marks it compacted too', async () => {
    const messages = [
      makeMessage({
        id: 'old-summary',
        text: 'Conversation compacted...\n\nprior summary text',
        metadata: {system: true, compactionSummary: true},
      }),
      ...manyUserMessages(14, 100),
    ];
    mockGetSessionById.mockResolvedValue({messages: [...messages].reverse()});

    await maybeCompactSession('session-1');

    expect(mockUpdateMessage).toHaveBeenCalledWith('old-summary', 'session-1', {
      metadata: {compacted: true},
    });
  });

  it('does not throw and makes no writes when the completion fails', async () => {
    mockGetSessionById.mockResolvedValue({
      messages: [...manyUserMessages(14)].reverse(),
    });
    mockCreateExtractionCompletionFn.mockResolvedValue({
      complete: jest.fn().mockRejectedValue(new Error('boom')),
      extractedBy: 'draft-model',
    });

    await expect(maybeCompactSession('session-1')).resolves.toBeUndefined();

    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(mockAddMessageToCurrentSession).not.toHaveBeenCalled();
  });

  it('does not throw and makes no writes when the model returns unparseable output', async () => {
    mockGetSessionById.mockResolvedValue({
      messages: [...manyUserMessages(14)].reverse(),
    });
    mockCreateExtractionCompletionFn.mockResolvedValue({
      complete: jest.fn().mockResolvedValue('not json at all'),
      extractedBy: 'draft-model',
    });

    await expect(maybeCompactSession('session-1')).resolves.toBeUndefined();

    expect(mockUpdateMessage).not.toHaveBeenCalled();
  });

  it('does not throw when the session cannot be found', async () => {
    mockGetSessionById.mockResolvedValue(null);

    await expect(maybeCompactSession('session-1')).resolves.toBeUndefined();
  });

  it('does not throw when getSessionById rejects', async () => {
    mockGetSessionById.mockRejectedValue(new Error('db exploded'));

    await expect(maybeCompactSession('session-1')).resolves.toBeUndefined();
  });

  it('excludes already-compacted messages from the eligible range', async () => {
    const messages = [
      ...manyUserMessages(8).map(m => ({
        toMessageObject: () => ({
          ...m.toMessageObject(),
          metadata: {compacted: true},
        }),
      })),
      ...manyUserMessages(6, 100),
    ];
    mockGetSessionById.mockResolvedValue({messages: [...messages].reverse()});

    await maybeCompactSession('session-1');

    // All 8 "eligible" messages are already compacted, and the remaining 6
    // are the kept tail — nothing left to compact.
    expect(mockCreateExtractionCompletionFn).not.toHaveBeenCalled();
  });
});
