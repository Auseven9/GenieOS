import {
  schemaMigrations,
  createTable,
  addColumns,
} from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
    // Initial migration is handled by the schema
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'cached_pals',
          columns: [
            {name: 'palshub_id', type: 'string', isIndexed: true},
            {name: 'title', type: 'string'},
            {name: 'description', type: 'string', isOptional: true},
            {name: 'thumbnail_url', type: 'string', isOptional: true},
            {name: 'creator_id', type: 'string'},
            {name: 'creator_name', type: 'string', isOptional: true},
            {name: 'creator_avatar_url', type: 'string', isOptional: true},
            {name: 'protection_level', type: 'string'},
            {name: 'price_cents', type: 'number'},
            {name: 'allow_fork', type: 'boolean'},
            {name: 'average_rating', type: 'number', isOptional: true},
            {name: 'review_count', type: 'number'},
            {name: 'is_owned', type: 'boolean'},
            {name: 'categories', type: 'string'}, // JSON array
            {name: 'tags', type: 'string'}, // JSON array
            {name: 'system_prompt', type: 'string', isOptional: true},
            {name: 'model_settings', type: 'string'}, // JSON object
            {name: 'cached_at', type: 'number'},
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
        createTable({
          name: 'user_library',
          columns: [
            {name: 'user_id', type: 'string', isIndexed: true},
            {name: 'palshub_id', type: 'string', isIndexed: true},
            {name: 'purchased_at', type: 'number'},
            {name: 'purchase_id', type: 'string', isOptional: true},
            {name: 'is_downloaded', type: 'boolean'},
            {name: 'download_path', type: 'string', isOptional: true},
            {name: 'created_at', type: 'number'},
          ],
        }),
        createTable({
          name: 'sync_status',
          columns: [
            {name: 'entity_type', type: 'string', isIndexed: true},
            {name: 'entity_id', type: 'string', isOptional: true},
            {name: 'last_sync', type: 'number'},
            {name: 'sync_version', type: 'string', isOptional: true},
            {name: 'status', type: 'string'},
            {name: 'error_message', type: 'string', isOptional: true},
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
      ],
    },
    // Migration to version 3: Add local_pals table
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'local_pals',
          columns: [
            {name: 'name', type: 'string'},
            {name: 'system_prompt', type: 'string'},
            {name: 'original_system_prompt', type: 'string', isOptional: true},
            {name: 'is_system_prompt_changed', type: 'boolean'},
            {name: 'use_ai_prompt', type: 'boolean'},
            {name: 'default_model', type: 'string', isOptional: true}, // JSON stringified
            {name: 'prompt_generation_model', type: 'string', isOptional: true}, // JSON stringified
            {name: 'generating_prompt', type: 'string', isOptional: true},
            {name: 'color', type: 'string', isOptional: true}, // JSON stringified [string, string]
            {name: 'capabilities', type: 'string'}, // JSON stringified PalCapabilities
            {name: 'parameters', type: 'string'}, // JSON stringified Record<string, any>
            {name: 'parameter_schema', type: 'string'}, // JSON stringified ParameterDefinition[]
            {name: 'source', type: 'string'}, // 'local' | 'palshub'
            {name: 'palshub_id', type: 'string', isOptional: true},
            {name: 'creator_info', type: 'string', isOptional: true}, // JSON stringified
            {name: 'categories', type: 'string', isOptional: true}, // JSON stringified string[]
            {name: 'tags', type: 'string', isOptional: true}, // JSON stringified string[]
            {name: 'rating', type: 'number', isOptional: true},
            {name: 'review_count', type: 'number', isOptional: true},
            {name: 'protection_level', type: 'string', isOptional: true},
            {name: 'price_cents', type: 'number', isOptional: true},
            {name: 'is_owned', type: 'boolean', isOptional: true},
            {name: 'generation_settings', type: 'string', isOptional: true}, // JSON stringified
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
      ],
    },
    // Migration to version 4: Add description column to local_pals
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'local_pals',
          columns: [{name: 'description', type: 'string', isOptional: true}],
        }),
      ],
    },
    // Migration to version 5: Add thumbnail_url column to local_pals
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'local_pals',
          columns: [{name: 'thumbnail_url', type: 'string', isOptional: true}],
        }),
      ],
    },
    // Migration to version 6: Add settings_source column to chat_sessions
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: 'chat_sessions',
          columns: [
            {name: 'settings_source', type: 'string', isOptional: true},
          ],
        }),
      ],
    },
    // Migration to version 7: Add pact and greeting columns to local_pals
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: 'local_pals',
          columns: [
            {name: 'pact', type: 'string', isOptional: true}, // JSON stringified { talents: TalentRef[] }
            {name: 'greeting', type: 'string', isOptional: true}, // JSON stringified Pal['greeting']
          ],
        }),
      ],
    },
    // Migration to version 8: Add pinned column to chat_sessions
    {
      toVersion: 8,
      steps: [
        addColumns({
          table: 'chat_sessions',
          columns: [{name: 'pinned', type: 'boolean'}],
        }),
      ],
    },
    // Migration to version 9: Add memories table (long-term memory store)
    {
      toVersion: 9,
      steps: [
        createTable({
          name: 'memories',
          columns: [
            {name: 'kind', type: 'string', isIndexed: true},
            {name: 'content', type: 'string'},
            {name: 'embedding', type: 'string', isOptional: true},
            {name: 'confidence', type: 'number'},
            {name: 'valence', type: 'number', isOptional: true},
            {name: 'intensity', type: 'number', isOptional: true},
            {name: 'provenance', type: 'string', isIndexed: true},
            {
              name: 'source_conversation_id',
              type: 'string',
              isOptional: true,
            },
            {name: 'tags', type: 'string'},
            {name: 'pinned', type: 'boolean'},
            {name: 'superseded_by', type: 'string', isOptional: true},
            {name: 'status', type: 'string', isIndexed: true},
            {name: 'last_accessed_at', type: 'number', isOptional: true},
            {name: 'access_count', type: 'number'},
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
      ],
    },
    // Migration to version 10: associative memory graph (nodes, typed
    // edges, and scoping compartments) layered on top of the flat
    // `memories` store.
    {
      toVersion: 10,
      steps: [
        createTable({
          name: 'memory_compartments',
          columns: [
            {name: 'name', type: 'string', isIndexed: true},
            {name: 'description', type: 'string', isOptional: true},
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
        createTable({
          name: 'memory_nodes',
          columns: [
            {name: 'label', type: 'string', isIndexed: true},
            {name: 'kind', type: 'string', isIndexed: true},
            {name: 'description', type: 'string', isOptional: true},
            {name: 'embedding', type: 'string', isOptional: true},
            {name: 'confidence', type: 'number'},
            {name: 'valence', type: 'number', isOptional: true},
            {name: 'intensity', type: 'number', isOptional: true},
            {
              name: 'compartment_id',
              type: 'string',
              isOptional: true,
              isIndexed: true,
            },
            {name: 'provenance', type: 'string', isIndexed: true},
            {name: 'source_memory_id', type: 'string', isOptional: true},
            {name: 'pinned', type: 'boolean'},
            {name: 'status', type: 'string', isIndexed: true},
            {name: 'last_accessed_at', type: 'number', isOptional: true},
            {name: 'access_count', type: 'number'},
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
        createTable({
          name: 'memory_edges',
          columns: [
            {name: 'source_node_id', type: 'string', isIndexed: true},
            {name: 'target_node_id', type: 'string', isIndexed: true},
            {name: 'relation', type: 'string', isIndexed: true},
            {name: 'weight', type: 'number'},
            {name: 'confidence', type: 'number'},
            {name: 'provenance', type: 'string', isIndexed: true},
            {
              name: 'source_conversation_id',
              type: 'string',
              isOptional: true,
            },
            {name: 'status', type: 'string', isIndexed: true},
            {name: 'created_at', type: 'number'},
            {name: 'updated_at', type: 'number'},
          ],
        }),
      ],
    },
    // Migration to version 11: Tulving episodic/semantic split and node
    // salience, so extraction can capture the full psychological texture
    // of a memory (not just what it says, but what kind of memory it is
    // and how central it is) from the start.
    {
      toVersion: 11,
      steps: [
        addColumns({
          table: 'memory_nodes',
          columns: [
            {name: 'memory_type', type: 'string', isIndexed: true},
            {name: 'salience', type: 'number', isOptional: true},
          ],
        }),
      ],
    },
    // Migration to version 12: provenance/audit fields (extracted_by,
    // source_conversation_id on nodes; extracted_by + access tracking on
    // edges) for the write-path security/audit layer.
    {
      toVersion: 12,
      steps: [
        addColumns({
          table: 'memory_nodes',
          columns: [
            {name: 'source_conversation_id', type: 'string', isOptional: true},
            {name: 'extracted_by', type: 'string', isOptional: true},
          ],
        }),
        addColumns({
          table: 'memory_edges',
          columns: [
            {name: 'extracted_by', type: 'string', isOptional: true},
            {name: 'last_accessed_at', type: 'number', isOptional: true},
            {name: 'access_count', type: 'number'},
          ],
        }),
      ],
    },
  ],
});
