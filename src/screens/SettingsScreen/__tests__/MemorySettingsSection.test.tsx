import React from 'react';
import {fireEvent, waitFor} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {MemorySettingsSection} from '../MemorySettingsSection';
import {memorySettingsStore} from '../../../store';

const mockForceRunIdleSweep = jest.fn();
jest.mock('../../../services/memory/MemorySweepScheduler', () => ({
  forceRunIdleSweep: (...args: any[]) => mockForceRunIdleSweep(...args),
}));

const mockGetWorldviewSummary = jest.fn();
jest.mock('../../../services/memory/MemorySweepPipeline', () => ({
  getWorldviewSummary: (...args: any[]) => mockGetWorldviewSummary(...args),
}));

describe('MemorySettingsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    memorySettingsStore.enabled = false;
    memorySettingsStore.embeddingModelPath = undefined;
    memorySettingsStore.idleSweepEnabled = false;
    memorySettingsStore.idleSweepIntervalHours = 24;
    memorySettingsStore.lastSweepAt = undefined;
    mockGetWorldviewSummary.mockResolvedValue(undefined);
    mockForceRunIdleSweep.mockResolvedValue(undefined);
  });

  it('hides idle-sweep and worldview controls while memory itself is off', () => {
    const {queryByTestId, queryByText} = render(<MemorySettingsSection />);

    expect(queryByTestId('memory-idle-sweep-enabled-switch')).toBeNull();
    expect(queryByText('Current world view')).toBeNull();
  });

  it('shows the idle-sweep toggle once memory is enabled', () => {
    memorySettingsStore.enabled = true;
    const {getByTestId, getByText} = render(<MemorySettingsSection />);

    expect(getByTestId('memory-idle-sweep-enabled-switch')).toBeTruthy();
    expect(getByText('Current world view')).toBeTruthy();
  });

  it('shows the interval picker and sweep-now button once idle sweep is enabled', () => {
    memorySettingsStore.enabled = true;
    memorySettingsStore.idleSweepEnabled = true;
    const {getByTestId, getByText} = render(<MemorySettingsSection />);

    expect(getByTestId('memory-idle-sweep-run-now-button')).toBeTruthy();
    expect(getByText('1 day')).toBeTruthy();
  });

  it('shows "Last swept: never" before any sweep has run', () => {
    memorySettingsStore.enabled = true;
    memorySettingsStore.idleSweepEnabled = true;
    const {getByText} = render(<MemorySettingsSection />);

    expect(getByText('Last swept: never')).toBeTruthy();
  });

  it('toggling the idle-sweep switch calls the store setter', () => {
    memorySettingsStore.enabled = true;
    const {getByTestId} = render(<MemorySettingsSection />);

    fireEvent(
      getByTestId('memory-idle-sweep-enabled-switch'),
      'onValueChange',
      true,
    );

    expect(memorySettingsStore.setIdleSweepEnabled).toHaveBeenCalledWith(true);
  });

  it('"Sweep now" triggers a forced sweep and refreshes the worldview summary', async () => {
    memorySettingsStore.enabled = true;
    memorySettingsStore.idleSweepEnabled = true;
    mockGetWorldviewSummary
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('a fresh summary');
    const {getByTestId, getByText} = render(<MemorySettingsSection />);

    fireEvent.press(getByTestId('memory-idle-sweep-run-now-button'));

    await waitFor(() => {
      expect(mockForceRunIdleSweep).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getByText('a fresh summary')).toBeTruthy();
    });
  });

  it('shows the synthesized worldview summary when one exists', async () => {
    memorySettingsStore.enabled = true;
    mockGetWorldviewSummary.mockResolvedValue('The user prefers dark mode.');
    const {getByText} = render(<MemorySettingsSection />);

    await waitFor(() => {
      expect(getByText('The user prefers dark mode.')).toBeTruthy();
    });
  });
});
