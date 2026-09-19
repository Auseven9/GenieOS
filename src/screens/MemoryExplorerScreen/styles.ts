import {Platform, StyleSheet} from 'react-native';

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
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    searchInput: {
      flex: 1,
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
    activityFeedContent: {
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    // Same bounded/scrollable/monospace treatment as the sweep diagnostics
    // log in Settings — this is the same kind of append-only event feed,
    // just for graph writes instead of scheduler runs.
    logScrollContainer: {
      maxHeight: 400,
      marginBottom: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.surfaceVariant,
      padding: 8,
    },
    logText: {
      fontFamily: Platform.select({ios: 'Menlo', default: 'monospace'}),
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      marginBottom: 4,
    },
    logButtonRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
  });
