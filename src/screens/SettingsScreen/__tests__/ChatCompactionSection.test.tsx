import React from 'react';
import {fireEvent} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {ChatCompactionSection} from '../ChatCompactionSection';
import {chatCompactionStore} from '../../../store';

describe('ChatCompactionSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatCompactionStore.enabled = false;
  });

  it('reflects the current enabled state', () => {
    chatCompactionStore.enabled = true;
    const {getByTestId} = render(<ChatCompactionSection />);
    expect(getByTestId('chat-compaction-enabled-switch').props.value).toBe(
      true,
    );
  });

  it('turns compaction on via the store', () => {
    const {getByTestId} = render(<ChatCompactionSection />);

    fireEvent(
      getByTestId('chat-compaction-enabled-switch'),
      'onValueChange',
      true,
    );

    expect(chatCompactionStore.setEnabled).toHaveBeenCalledWith(true);
  });

  it('turns compaction off via the store', () => {
    chatCompactionStore.enabled = true;
    const {getByTestId} = render(<ChatCompactionSection />);

    fireEvent(
      getByTestId('chat-compaction-enabled-switch'),
      'onValueChange',
      false,
    );

    expect(chatCompactionStore.setEnabled).toHaveBeenCalledWith(false);
  });
});
