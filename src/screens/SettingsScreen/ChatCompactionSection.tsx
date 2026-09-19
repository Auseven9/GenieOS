import React, {useContext} from 'react';
import {View} from 'react-native';

import {observer} from 'mobx-react-lite';
import {Text, Card, Switch} from 'react-native-paper';

import {L10nContext} from '../../utils';
import {chatCompactionStore} from '../../store';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';

export const ChatCompactionSection = observer(() => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <Card elevation={0} style={styles.card}>
      <Card.Title title={l10n.settings.chatCompactionTitle} />
      <Card.Content>
        <View style={styles.settingItemContainer}>
          <View style={styles.switchContainer}>
            <View style={styles.textContainer}>
              <Text variant="titleMedium" style={styles.textLabel}>
                {l10n.settings.chatCompactionEnabledLabel}
              </Text>
              <Text variant="labelSmall" style={styles.textDescription}>
                {l10n.settings.chatCompactionEnabledDescription}
              </Text>
            </View>
            <Switch
              testID="chat-compaction-enabled-switch"
              value={chatCompactionStore.enabled}
              onValueChange={value => chatCompactionStore.setEnabled(value)}
            />
          </View>
        </View>
      </Card.Content>
    </Card>
  );
});
