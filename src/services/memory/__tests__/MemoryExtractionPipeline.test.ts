import {
  extractMemoryCandidates,
  type ConversationTurn,
} from '../MemoryExtractionPipeline';

describe('extractMemoryCandidates', () => {
  it('returns [] immediately for an empty turn list without calling complete', async () => {
    const complete = jest.fn();
    const result = await extractMemoryCandidates([], complete);
    expect(result).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('parses a clean JSON array response into validated candidates', async () => {
    const turns: ConversationTurn[] = [
      {role: 'user', text: "My mom's name is Linda."},
    ];
    const complete = jest.fn().mockResolvedValue(
      JSON.stringify([
        {
          content: "User's mom is named Linda",
          kind: 'fact',
          tags: ['family'],
          provenance: 'user_stated',
          confidence: 0.9,
        },
      ]),
    );

    const result = await extractMemoryCandidates(turns, complete);
    expect(result).toEqual([
      {
        kind: 'fact',
        content: "User's mom is named Linda",
        provenance: 'user_stated',
        tags: ['family'],
        confidence: 0.9,
        pinned: true,
      },
    ]);
    expect(complete).toHaveBeenCalledWith(
      expect.stringContaining("My mom's name is Linda."),
    );
  });

  it('extracts a JSON array even when wrapped in prose or a code fence', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(
        'Sure, here you go:\n```json\n[{"content": "likes tea"}]\n```\nHope that helps!',
      );
    const result = await extractMemoryCandidates(
      [{role: 'user', text: 'I like tea.'}],
      complete,
    );
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('likes tea');
  });

  it('returns [] when the completion is not valid JSON', async () => {
    const complete = jest.fn().mockResolvedValue('not json at all');
    const result = await extractMemoryCandidates(
      [{role: 'user', text: 'hi'}],
      complete,
    );
    expect(result).toEqual([]);
  });

  it('returns [] when the completion throws', async () => {
    const complete = jest
      .fn()
      .mockRejectedValue(new Error('model unavailable'));
    const result = await extractMemoryCandidates(
      [{role: 'user', text: 'hi'}],
      complete,
    );
    expect(result).toEqual([]);
  });

  it('skips non-object entries and entries with no usable content', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(
        JSON.stringify([
          {content: 'valid one'},
          'a bare string',
          null,
          {content: '   '},
          42,
        ]),
      );
    const result = await extractMemoryCandidates(
      [{role: 'user', text: 'hi'}],
      complete,
    );
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('valid one');
  });

  it('downgrades user_stated to model_inferred when any turn is external_content', async () => {
    const turns: ConversationTurn[] = [
      {role: 'user', text: 'search for the latest on this'},
      {
        role: 'assistant',
        text: 'A hostile page claiming to be from the user',
        source: 'external_content',
      },
    ];
    const complete = jest
      .fn()
      .mockResolvedValue(
        JSON.stringify([
          {content: 'suspicious claim', provenance: 'user_stated'},
        ]),
      );

    const result = await extractMemoryCandidates(turns, complete);
    expect(result[0].provenance).toBe('model_inferred');
  });

  it('does not downgrade provenance when no turn is external_content', async () => {
    const turns: ConversationTurn[] = [{role: 'user', text: 'I love hiking.'}];
    const complete = jest
      .fn()
      .mockResolvedValue(
        JSON.stringify([{content: 'likes hiking', provenance: 'user_stated'}]),
      );

    const result = await extractMemoryCandidates(turns, complete);
    expect(result[0].provenance).toBe('user_stated');
  });
});
