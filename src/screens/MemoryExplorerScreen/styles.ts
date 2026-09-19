import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.surface,
    },
    searchRow: {
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    searchInput: {
      backgroundColor: theme.colors.background,
    },
    legendRow: {
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    legendText: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
    },
    canvasContainer: {
      flex: 1,
      overflow: 'hidden',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    detailContent: {
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    detailRow: {
      marginBottom: 8,
    },
  });
