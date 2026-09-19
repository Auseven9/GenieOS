import React from 'react';
import {Alert} from 'react-native';
import {of, Subject} from 'rxjs';
import {act, fireEvent, waitFor} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {MemoryExplorerScreen} from '../MemoryExplorerScreen';
import type {MemoryNode} from '../../../types/memoryGraph';

const mockObserveNodes = jest.fn();
const mockObserveEdges = jest.fn();
const mockListCompartments = jest.fn();

jest.mock('../../../repositories/MemoryGraphRepository', () => ({
  __esModule: true,
  default: {
    observeNodes: (...args: any[]) => mockObserveNodes(...args),
    observeEdges: (...args: any[]) => mockObserveEdges(...args),
    listCompartments: (...args: any[]) => mockListCompartments(...args),
  },
}));

const mockGetMemoryActivityLog = jest.fn();
const mockClearMemoryActivityLog = jest.fn();
jest.mock('../../../services/memory/MemoryActivityLog', () => ({
  getMemoryActivityLog: (...args: any[]) => mockGetMemoryActivityLog(...args),
  clearMemoryActivityLog: (...args: any[]) =>
    mockClearMemoryActivityLog(...args),
}));

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: 'n1',
    label: 'cats',
    kind: 'topic',
    memoryType: 'semantic',
    confidence: 0.8,
    pinned: false,
    provenance: 'user_stated',
    status: 'active',
    accessCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MemoryExplorerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockObserveNodes.mockReturnValue(of([]));
    mockObserveEdges.mockReturnValue(of([]));
    mockListCompartments.mockResolvedValue([]);
    mockGetMemoryActivityLog.mockResolvedValue([]);
    mockClearMemoryActivityLog.mockResolvedValue(undefined);
  });

  it('shows the empty state when there are no memories', () => {
    const {getByText} = render(<MemoryExplorerScreen />);
    expect(getByText('No memories to show yet.')).toBeTruthy();
  });

  it('renders a node for each item emitted by observeNodes', () => {
    mockObserveNodes.mockReturnValue(
      of([makeNode({id: 'a'}), makeNode({id: 'b', label: 'dogs'})]),
    );
    const {getByTestId} = render(<MemoryExplorerScreen />);
    expect(getByTestId('memory-node-a')).toBeTruthy();
    expect(getByTestId('memory-node-b')).toBeTruthy();
  });

  it('opens a detail sheet with the node description when tapped', async () => {
    mockObserveNodes.mockReturnValue(
      of([makeNode({id: 'a', label: 'cats', description: 'likes cats'})]),
    );
    const {getByTestId, getByText} = render(<MemoryExplorerScreen />);

    fireEvent(getByTestId('memory-node-a'), 'onPress');

    await waitFor(() => {
      expect(getByText('likes cats')).toBeTruthy();
    });
  });

  it('caps rendered nodes but always includes a pinned one regardless of salience', () => {
    const many = Array.from({length: 65}, (_, i) =>
      makeNode({id: `n${i}`, salience: (i + 1) / 65}),
    );
    many[0] = {...many[0], pinned: true, salience: 0};
    mockObserveNodes.mockReturnValue(of(many));

    const {getByTestId, queryAllByTestId} = render(<MemoryExplorerScreen />);

    expect(getByTestId('memory-node-n0')).toBeTruthy();
    expect(queryAllByTestId(/^memory-node-/).length).toBeLessThanOrEqual(60);
  });

  it('unsubscribes from both live queries on unmount', () => {
    const unsubscribeNodes = jest.fn();
    const unsubscribeEdges = jest.fn();
    mockObserveNodes.mockReturnValue({
      subscribe: (observer: any) => {
        observer.next([]);
        return {unsubscribe: unsubscribeNodes};
      },
    });
    mockObserveEdges.mockReturnValue({
      subscribe: (observer: any) => {
        observer.next([]);
        return {unsubscribe: unsubscribeEdges};
      },
    });

    const {unmount} = render(<MemoryExplorerScreen />);
    unmount();

    expect(unsubscribeNodes).toHaveBeenCalledTimes(1);
    expect(unsubscribeEdges).toHaveBeenCalledTimes(1);
  });

  describe('activity feed', () => {
    it('shows the empty message when nothing has been logged', async () => {
      const {getByTestId, getByText} = render(<MemoryExplorerScreen />);

      fireEvent.press(getByTestId('memory-explorer-activity-feed-button'));

      await waitFor(() => {
        expect(getByText('No memory activity recorded yet.')).toBeTruthy();
      });
    });

    it('shows logged entries newest first', async () => {
      mockGetMemoryActivityLog.mockResolvedValue([
        {ts: 1, message: 'Remembered: cats'},
        {ts: 2, message: 'Remembered: dogs'},
      ]);
      const {getByTestId, getByText} = render(<MemoryExplorerScreen />);

      fireEvent.press(getByTestId('memory-explorer-activity-feed-button'));

      await waitFor(() => {
        expect(getByText(/Remembered: dogs/)).toBeTruthy();
        expect(getByText(/Remembered: cats/)).toBeTruthy();
      });
    });

    it('re-fetches the activity log each time the live node observable emits a new value', async () => {
      const subject = new Subject<MemoryNode[]>();
      mockObserveNodes.mockReturnValue(subject.asObservable());
      mockGetMemoryActivityLog.mockResolvedValue([]);
      render(<MemoryExplorerScreen />);

      act(() => {
        subject.next([]);
      });
      await waitFor(() => {
        expect(mockGetMemoryActivityLog.mock.calls.length).toBeGreaterThan(1);
      });
    });

    it('clears the log after confirming, then refreshes', async () => {
      mockGetMemoryActivityLog.mockResolvedValue([
        {ts: 1, message: 'Remembered: cats'},
      ]);
      mockClearMemoryActivityLog.mockImplementation(async () => {
        mockGetMemoryActivityLog.mockResolvedValue([]);
      });
      const alertSpy = jest
        .spyOn(Alert, 'alert')
        .mockImplementation((_title, _message, buttons) => {
          const confirm = buttons?.find(b => b.style === 'destructive');
          confirm?.onPress?.();
        });
      const {getByTestId, getByText} = render(<MemoryExplorerScreen />);

      fireEvent.press(getByTestId('memory-explorer-activity-feed-button'));
      await waitFor(() => {
        expect(getByText(/Remembered: cats/)).toBeTruthy();
      });

      fireEvent.press(getByTestId('memory-explorer-activity-clear-button'));

      await waitFor(() => {
        expect(mockClearMemoryActivityLog).toHaveBeenCalledTimes(1);
      });
      alertSpy.mockRestore();
    });
  });
});
