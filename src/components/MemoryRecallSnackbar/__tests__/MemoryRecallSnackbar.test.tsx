import React from 'react';
import {render as renderNative} from '@testing-library/react-native';
import {render, fireEvent} from '../../../../jest/test-utils';
import {MemoryRecallSnackbar} from '../MemoryRecallSnackbar';

describe('MemoryRecallSnackbar', () => {
  const mockDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when there is no recall', () => {
    const {toJSON} = renderNative(
      <MemoryRecallSnackbar recall={null} onDismiss={mockDismiss} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders null when the recall count is zero', () => {
    const {toJSON} = renderNative(
      <MemoryRecallSnackbar
        recall={{count: 0, snippets: []}}
        onDismiss={mockDismiss}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('shows the singular message for exactly one recalled memory', () => {
    const {getByText} = render(
      <MemoryRecallSnackbar
        recall={{count: 1, snippets: ['likes cats']}}
        onDismiss={mockDismiss}
      />,
    );
    expect(getByText('1 memory recalled')).toBeTruthy();
  });

  it('shows the plural message with the count interpolated for multiple memories', () => {
    const {getByText} = render(
      <MemoryRecallSnackbar
        recall={{count: 3, snippets: ['a', 'b', 'c']}}
        onDismiss={mockDismiss}
      />,
    );
    expect(getByText('3 memories recalled')).toBeTruthy();
  });

  it('calls onDismiss when the snackbar is dismissed', () => {
    const {getByTestId} = render(
      <MemoryRecallSnackbar
        recall={{count: 1, snippets: ['likes cats']}}
        onDismiss={mockDismiss}
      />,
    );
    fireEvent(getByTestId('memory-recall-snackbar'), 'onDismiss');
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
