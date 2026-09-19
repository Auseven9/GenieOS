import React from 'react';

import {render} from '../../../../jest/test-utils';
import {PermissionsInfoSection} from '../PermissionsInfoSection';

describe('PermissionsInfoSection', () => {
  it('renders an explanation for camera, notifications, and network access', () => {
    const {getByTestId, getByText} = render(<PermissionsInfoSection />);

    expect(getByTestId('permissions-info-card')).toBeTruthy();
    expect(getByText('Camera')).toBeTruthy();
    expect(getByText('Notifications')).toBeTruthy();
    expect(getByText('Network')).toBeTruthy();
  });
});
