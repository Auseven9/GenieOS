import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    snackbar: {
      backgroundColor: theme.colors.secondaryContainer,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    icon: {
      marginRight: 8,
    },
    message: {
      color: theme.colors.onSecondaryContainer,
      flex: 1,
    },
    wrapper: {
      zIndex: 9999,
    },
  });
