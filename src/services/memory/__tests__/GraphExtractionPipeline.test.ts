import {
  extractMemoryGraph,
  type ConversationTurn,
} from '../GraphExtractionPipeline';

const baseTurns: ConversationTurn[] = [
  {role: 'user', text: 'I love my two cats'},
];

describe('extractMemoryGraph', () => {
  it('returns empty nodes/edges when there are no turns', async () => {
    const complete = jest.fn();
    const result = await extractMemoryGraph([], complete);
    expect(result).toEqual({nodes: [], edges: []});
    expect(complete).not.toHaveBeenCalled();
  });

  it('parses nodes and edges from a well-formed JSON object response', async () => {
    const complete = jest.fn().mockResolvedValue(
      JSON.stringify({
        compartment: 'family',
        nodes: [
          {
            label: 'cats',
            content: 'the user has two cats',
            kind: 'topic',
            memory_type: 'semantic',
            confidence: 0.9,
            valence: 0.6,
            salience: 0.4,
            provenance: 'user_stated',
          },
          {
            label: 'pet ownership',
            content: 'the user owns pets',
            kind: 'concept',
            memory_type: 'semantic',
          },
        ],
        edges: [
          {
            source_label: 'cats',
            target_label: 'pet ownership',
            relation_type: 'SUPPORTS',
            weight: 0.8,
          },
        ],
      }),
    );

    const result = await extractMemoryGraph(baseTurns, complete);

    expect(result.compartment).toBe('family');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({label: 'cats', confidence: 0.9});
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      sourceLabel: 'cats',
      targetLabel: 'pet ownership',
      relation: 'SUPPORTS',
    });
  });

  it('extracts a JSON object even when wrapped in prose or a code fence', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(
        'Sure, here you go:\n```json\n' +
          JSON.stringify({nodes: [{label: 'cats', content: 'x'}], edges: []}) +
          '\n```',
      );
    const result = await extractMemoryGraph(baseTurns, complete);
    expect(result.nodes).toHaveLength(1);
  });

  it("drops edges referencing a label not present among this pass's nodes", async () => {
    const complete = jest.fn().mockResolvedValue(
      JSON.stringify({
        nodes: [{label: 'cats', content: 'x'}],
        edges: [
          {
            source_label: 'cats',
            target_label: 'a node from some prior turn',
            relation_type: 'MENTIONS',
          },
        ],
      }),
    );
    const result = await extractMemoryGraph(baseTurns, complete);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it('returns empty when the completion throws', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('boom'));
    const result = await extractMemoryGraph(baseTurns, complete);
    expect(result).toEqual({nodes: [], edges: []});
  });

  it('returns empty when the completion is not parseable JSON', async () => {
    const complete = jest.fn().mockResolvedValue('not json at all');
    const result = await extractMemoryGraph(baseTurns, complete);
    expect(result).toEqual({nodes: [], edges: []});
  });

  it('downgrades user_stated provenance to model_inferred when a turn is external content', async () => {
    const complete = jest.fn().mockResolvedValue(
      JSON.stringify({
        nodes: [
          {
            label: 'cats',
            content: 'x',
            provenance: 'user_stated',
          },
        ],
        edges: [],
      }),
    );
    const turnsWithExternalContent: ConversationTurn[] = [
      {role: 'user', text: 'search for cats'},
      {
        role: 'assistant',
        text: 'a page about cats',
        source: 'external_content',
      },
    ];

    const result = await extractMemoryGraph(turnsWithExternalContent, complete);
    expect(result.nodes[0].provenance).toBe('model_inferred');
  });
});
