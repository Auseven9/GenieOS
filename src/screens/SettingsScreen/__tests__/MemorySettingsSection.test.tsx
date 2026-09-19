import React from 'react';
import {Alert} from 'react-native';
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

const mockEnsureNotificationPermission = jest.fn();
jest.mock('../../../services/notifications/SweepNotificationService', () => ({
  ensureNotificationPermission: (...args: any[]) =>
    mockEnsureNotificationPermission(...args),
}));

describe('MemorySettingsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    memorySettingsStore.enabled = false;
    memorySettingsStore.embeddingModelPath = undefined;
    memorySettingsStore.idleSweepEnabled = false;
    memorySettingsStore.idleSweepIntervalHours = 24;
    memorySettingsStore.lastSweepAt = undefined;
    memorySettingsStore.sweepNotificationsEnabled = false;
    mockGetWorldviewSummary.mockResolvedValue(undefined);
    mockForceRunIdleSweep.mockResolvedValue(undefined);
    mockEnsureNotificationPermission.mockResolvedValue(true);
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

  describe('sweep-notifications toggle', () => {
    it('only appears once idle sweep is enabled', () => {
      memorySettingsStore.enabled = true;
      const {queryByTestId} = render(<MemorySettingsSection />);
      expect(queryByTestId('memory-sweep-notifications-switch')).toBeNull();
    });

    it('requests permission and enables the setting when granted', async () => {
      memorySettingsStore.enabled = true;
      memorySettingsStore.idleSweepEnabled = true;
      mockEnsureNotificationPermission.mockResolvedValue(true);
      const {getByTestId} = render(<MemorySettingsSection />);

      fireEvent(
        getByTestId('memory-sweep-notifications-switch'),
        'onValueChange',
        true,
      );

      await waitFor(() => {
        expect(mockEnsureNotificationPermission).toHaveBeenCalledTimes(1);
      });
      expect(
        memorySettingsStore.setSweepNotificationsEnabled,
      ).toHaveBeenCalledWith(true);
    });

    it('alerts and does not enable the setting when permission is denied', async () => {
      memorySettingsStore.enabled = true;
      memorySettingsStore.idleSweepEnabled = true;
      mockEnsureNotificationPermission.mockResolvedValue(false);
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const {getByTestId} = render(<MemorySettingsSection />);

      fireEvent(
        getByTestId('memory-sweep-notifications-switch'),
        'onValueChange',
        true,
      );

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledTimes(1);
      });
      expect(
        memorySettingsStore.setSweepNotificationsEnabled,
      ).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('turns the setting off directly, without requesting permission', () => {
      memorySettingsStore.enabled = true;
      memorySettingsStore.idleSweepEnabled = true;
      memorySettingsStore.sweepNotificationsEnabled = true;
      const {getByTestId} = render(<MemorySettingsSection />);

      fireEvent(
        getByTestId('memory-sweep-notifications-switch'),
        'onValueChange',
        false,
      );

      expect(mockEnsureNotificationPermission).not.toHaveBeenCalled();
      expect(
        memorySettingsStore.setSweepNotificationsEnabled,
      ).toHaveBeenCalledWith(false);
    });
  });
});
