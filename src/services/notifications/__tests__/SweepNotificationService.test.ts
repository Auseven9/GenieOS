const mockRequestPermission = jest.fn();
const mockGetNotificationSettings = jest.fn();
const mockCreateChannel = jest.fn();
const mockDisplayNotification = jest.fn();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    requestPermission: (...args: any[]) => mockRequestPermission(...args),
    getNotificationSettings: (...args: any[]) =>
      mockGetNotificationSettings(...args),
    createChannel: (...args: any[]) => mockCreateChannel(...args),
    displayNotification: (...args: any[]) => mockDisplayNotification(...args),
  },
  AndroidImportance: {LOW: 2},
  AuthorizationStatus: {DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2},
}));

import {
  ensureNotificationPermission,
  notifySweepComplete,
} from '../SweepNotificationService';

describe('SweepNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureNotificationPermission', () => {
    it('returns true when authorized', async () => {
      mockRequestPermission.mockResolvedValue({authorizationStatus: 1});
      await expect(ensureNotificationPermission()).resolves.toBe(true);
    });

    it('returns false when denied', async () => {
      mockRequestPermission.mockResolvedValue({authorizationStatus: 0});
      await expect(ensureNotificationPermission()).resolves.toBe(false);
    });

    it('returns false rather than throwing when the request itself fails', async () => {
      mockRequestPermission.mockRejectedValue(new Error('native error'));
      await expect(ensureNotificationPermission()).resolves.toBe(false);
    });
  });

  describe('notifySweepComplete', () => {
    it('does nothing when not authorized', async () => {
      mockGetNotificationSettings.mockResolvedValue({authorizationStatus: 0});
      await notifySweepComplete();
      expect(mockDisplayNotification).not.toHaveBeenCalled();
    });

    it('creates the channel and displays a generic notification when authorized, only creating the channel once across repeated calls', async () => {
      mockGetNotificationSettings.mockResolvedValue({authorizationStatus: 1});
      await notifySweepComplete();
      await notifySweepComplete();

      expect(mockCreateChannel).toHaveBeenCalledTimes(1);
      expect(mockCreateChannel).toHaveBeenCalledWith(
        expect.objectContaining({id: 'memory-sweeps'}),
      );
      expect(mockDisplayNotification).toHaveBeenCalledTimes(2);
      expect(mockDisplayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.any(String),
          body: expect.any(String),
        }),
      );
    });

    it('never includes memory content, only the fixed generic strings', async () => {
      mockGetNotificationSettings.mockResolvedValue({authorizationStatus: 1});
      await notifySweepComplete();

      const call = mockDisplayNotification.mock.calls[0][0];
      expect(typeof call.title).toBe('string');
      expect(typeof call.body).toBe('string');
      expect(mockDisplayNotification.mock.calls[0]).toHaveLength(1);
    });

    it('swallows errors rather than throwing', async () => {
      mockGetNotificationSettings.mockRejectedValue(new Error('boom'));
      await expect(notifySweepComplete()).resolves.toBeUndefined();
    });
  });
});
