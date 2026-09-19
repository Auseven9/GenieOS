import React, {useContext} from 'react';
import {View} from 'react-native';

import {Text, Card} from 'react-native-paper';

import {Divider} from '../../components';
import {L10nContext} from '../../utils';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';

/**
 * Purely informational — no toggles here, since every permission it
 * describes is already granted (or requested) at its own point of use:
 * camera in chat, notifications via the sweep-notification toggle above,
 * network for downloads/search. This just answers "what does the app
 * access and why" in one place, since nothing else in Settings does.
 */
export const PermissionsInfoSection: React.FC = () => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <Card elevation={0} style={styles.card} testID="permissions-info-card">
      <Card.Title title={l10n.settings.permissionsInfoTitle} />
      <Card.Content>
        <View style={styles.settingItemContainer}>
          <Text variant="titleMedium" style={styles.textLabel}>
            {l10n.settings.permissionsInfoCameraLabel}
          </Text>
          <Text variant="labelSmall" style={styles.textDescription}>
            {l10n.settings.permissionsInfoCameraDescription}
          </Text>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.settingItemContainer}>
          <Text variant="titleMedium" style={styles.textLabel}>
            {l10n.settings.permissionsInfoNotificationsLabel}
          </Text>
          <Text variant="labelSmall" style={styles.textDescription}>
            {l10n.settings.permissionsInfoNotificationsDescription}
          </Text>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.settingItemContainer}>
          <Text variant="titleMedium" style={styles.textLabel}>
            {l10n.settings.permissionsInfoNetworkLabel}
          </Text>
          <Text variant="labelSmall" style={styles.textDescription}>
            {l10n.settings.permissionsInfoNetworkDescription}
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
};
