import React, {useContext} from 'react';
import {View} from 'react-native';
import {Portal, Snackbar, Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {createStyles} from './styles';

interface MemoryRecallSnackbarProps {
  recall: {count: number; snippets: string[]} | null;
  onDismiss: () => void;
}

// A brief, non-blocking "N memories recalled" notice — the live half of
// the memory-recall signal buildMemoryDigest produces per turn (the other
// half, the persisted MemoryActivityLog feed, lives in the Memory
// Explorer's Activity panel). Auto-dismisses on its own; never blocks or
// requires interaction, since a failed/skipped recall must never read as
// an error to the user.
export const MemoryRecallSnackbar: React.FC<MemoryRecallSnackbarProps> = ({
  recall,
  onDismiss,
}) => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);

  if (!recall || recall.count === 0) {
    return null;
  }

  const styles = createStyles(theme);
  const message =
    recall.count === 1
      ? l10n.chat.memoryRecalledOne
      : l10n.chat.memoryRecalledMany.replace('{{count}}', String(recall.count));

  return (
    <Portal>
      <Snackbar
        testID="memory-recall-snackbar"
        visible={true}
        onDismiss={onDismiss}
        duration={4000}
        style={styles.snackbar}
        wrapperStyle={styles.wrapper}>
        <View style={styles.content}>
          <Icon
            name="brain"
            size={20}
            color={theme.colors.onSecondaryContainer}
            style={styles.icon}
          />
          <Text style={styles.message}>{message}</Text>
        </View>
      </Snackbar>
    </Portal>
  );
};
