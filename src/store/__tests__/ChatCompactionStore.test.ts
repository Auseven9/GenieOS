import {chatCompactionStore} from '../ChatCompactionStore';
import chatCompactionRepository from '../../repositories/ChatCompactionRepository';

// Mirrors MemorySettingsStore.test.ts: import the real singleton (already
// constructed once at module load) and mock the repository it wraps.
jest.mock('../../repositories/ChatCompactionRepository');

describe('ChatCompactionStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatCompactionStore.enabled = false;
  });

  it('setEnabled updates observable state and persists', async () => {
    (
      chatCompactionRepository.setCompactionEnabled as jest.Mock
    ).mockResolvedValue(undefined);

    await chatCompactionStore.setEnabled(true);

    expect(chatCompactionStore.enabled).toBe(true);
    expect(chatCompactionRepository.setCompactionEnabled).toHaveBeenCalledWith(
      true,
    );
  });

  it('setEnabled(false) updates observable state and persists', async () => {
    chatCompactionStore.enabled = true;
    (
      chatCompactionRepository.setCompactionEnabled as jest.Mock
    ).mockResolvedValue(undefined);

    await chatCompactionStore.setEnabled(false);

    expect(chatCompactionStore.enabled).toBe(false);
    expect(chatCompactionRepository.setCompactionEnabled).toHaveBeenCalledWith(
      false,
    );
  });
});
