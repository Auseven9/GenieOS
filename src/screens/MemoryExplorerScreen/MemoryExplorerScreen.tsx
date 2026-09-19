import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {Alert, ScrollView, View, useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, {Circle, Line} from 'react-native-svg';
import {Button, IconButton, Text, TextInput} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';

import {Sheet} from '../../components';
import {L10nContext} from '../../utils';
import {useTheme} from '../../hooks';
import memoryGraphRepository from '../../repositories/MemoryGraphRepository';
import type {
  MemoryNode,
  MemoryEdge,
  MemoryCompartment,
} from '../../types/memoryGraph';
import {
  computeForceDirectedLayout,
  type LayoutPosition,
} from '../../utils/forceDirectedLayout';
import {
  valenceToColor,
  salienceToRadius,
  confidenceToOpacity,
  SEARCH_DIM_MULTIPLIER,
} from '../../utils/memoryNodeVisuals';
import {
  getMemoryActivityLog,
  clearMemoryActivityLog,
  type MemoryActivityEntry,
} from '../../services/memory/MemoryActivityLog';
import {createStyles} from './styles';

// No pagination/limit exists anywhere in MemoryGraphRepository — observeNodes
// returns every active node. A force-directed layout gets slow and
// unreadable well before a few hundred nodes, so this caps what actually
// renders. Pinned nodes are always included regardless of salience; the
// remainder is topped up by salience (highest first), since salience is
// the field that's explicitly "how central this is."
const MAX_RENDERED_NODES = 60;

// A node touched this recently gets a "just recalled" ring — the visual
// half of the memory-access reinforcement decay.ts already tracks
// (recordNodeAccess resets lastAccessedAt). No live pulse animation: with
// up to MAX_RENDERED_NODES animating simultaneously that's a real perf
// cost for a static-until-refresh indicator to buy little.
const RECENT_ACCESS_WINDOW_MS = 5 * 60 * 1000;

const PINNED_RING_COLOR = '#FFD700';
const RECENT_RING_COLOR = '#42A5F5';

function pickVisibleNodes(nodes: MemoryNode[]): MemoryNode[] {
  if (nodes.length <= MAX_RENDERED_NODES) {
    return nodes;
  }
  const pinned = nodes.filter(n => n.pinned);
  const rest = nodes
    .filter(n => !n.pinned)
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
  return [...pinned, ...rest].slice(0, MAX_RENDERED_NODES);
}

function isRecentlyAccessed(node: MemoryNode, now: number): boolean {
  if (!node.lastAccessedAt) {
    return false;
  }
  return (
    now - new Date(node.lastAccessedAt).getTime() < RECENT_ACCESS_WINDOW_MS
  );
}

export const MemoryExplorerScreen: React.FC = () => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);
  const {width, height} = useWindowDimensions();

  const [allNodes, setAllNodes] = useState<MemoryNode[]>([]);
  const [allEdges, setAllEdges] = useState<MemoryEdge[]>([]);
  const [compartments, setCompartments] = useState<MemoryCompartment[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    undefined,
  );
  const [query, setQuery] = useState('');
  const [isActivityFeedVisible, setIsActivityFeedVisible] = useState(false);
  const [activityEntries, setActivityEntries] = useState<MemoryActivityEntry[]>(
    [],
  );

  const refreshActivityLog = useCallback(() => {
    getMemoryActivityLog()
      .then(setActivityEntries)
      .catch(() => {
        // getMemoryActivityLog already logs; nothing more to do here.
      });
  }, []);

  useEffect(() => {
    const nodesSub = memoryGraphRepository.observeNodes().subscribe({
      next: setAllNodes,
      error: error =>
        console.error('MemoryExplorerScreen: node subscription failed:', error),
    });
    const edgesSub = memoryGraphRepository.observeEdges().subscribe({
      next: setAllEdges,
      error: error =>
        console.error('MemoryExplorerScreen: edge subscription failed:', error),
    });
    memoryGraphRepository
      .listCompartments()
      .then(setCompartments)
      .catch(() => {});
    refreshActivityLog();
    return () => {
      nodesSub.unsubscribe();
      edgesSub.unsubscribe();
    };
  }, [refreshActivityLog]);

  // Every write this screen's activity feed cares about (a node created,
  // updated, retired, or superseded) also touches the live node/edge
  // observables above, so re-reading the activity log whenever either
  // fires keeps the feed live without polling or a second observable.
  useEffect(() => {
    refreshActivityLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNodes, allEdges]);

  const handleCopyActivityLog = () => {
    const logText = activityEntries
      .map(entry => `${new Date(entry.ts).toLocaleString()}  ${entry.message}`)
      .join('\n');
    Clipboard.setString(logText);
    Alert.alert('', l10n.components.memoryExplorer.activityFeedCopiedMessage);
  };

  const handleClearActivityLog = () => {
    Alert.alert(
      l10n.components.memoryExplorer.activityFeedClearConfirmTitle,
      l10n.components.memoryExplorer.activityFeedClearConfirmMessage,
      [
        {text: l10n.common.cancel, style: 'cancel'},
        {
          text: l10n.common.clear,
          style: 'destructive',
          onPress: () => {
            clearMemoryActivityLog().then(refreshActivityLog);
          },
        },
      ],
    );
  };

  const visibleNodes = useMemo(() => pickVisibleNodes(allNodes), [allNodes]);
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(n => n.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      allEdges.filter(
        e =>
          visibleNodeIds.has(e.sourceNodeId) &&
          visibleNodeIds.has(e.targetNodeId),
      ),
    [allEdges, visibleNodeIds],
  );

  const canvasWidth = width * 2;
  const canvasHeight = height * 2;

  // Recomputed only when the actual SET of rendered nodes/edges changes —
  // not on every field update (e.g. a confidence tweak) — so the graph
  // doesn't visibly re-jumble itself on every unrelated write.
  const layoutKey = useMemo(
    () =>
      `${visibleNodes
        .map(n => n.id)
        .sort()
        .join(',')}|${visibleEdges
        .map(e => `${e.sourceNodeId}-${e.targetNodeId}`)
        .sort()
        .join(',')}`,
    [visibleNodes, visibleEdges],
  );
  const positions = useMemo<Map<string, LayoutPosition>>(() => {
    const layout = computeForceDirectedLayout(
      visibleNodes.map(n => ({id: n.id, weight: 0.6 + (n.salience ?? 0.4)})),
      visibleEdges.map(e => ({
        sourceId: e.sourceNodeId,
        targetId: e.targetNodeId,
        strength: e.weight,
      })),
      {width: canvasWidth, height: canvasHeight},
    );
    return new Map(layout.map(p => [p.id, p]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, canvasWidth, canvasHeight]);

  const selectedNode = allNodes.find(n => n.id === selectedNodeId);
  const selectedCompartment = compartments.find(
    c => c.id === selectedNode?.compartmentId,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const nodeMatchesQuery = (node: MemoryNode) =>
    !normalizedQuery || node.label.toLowerCase().includes(normalizedQuery);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  // minDistance keeps a quick tap on a node from being swallowed as a pan —
  // gesture-handler won't claim the responder until the finger actually
  // moves this far, leaving a plain tap to react-native-svg's own onPress.
  const panGesture = Gesture.Pan()
    .minDistance(10)
    .onUpdate(e => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.max(0.25, Math.min(4, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      {translateX: translateX.value},
      {translateY: translateY.value},
      {scale: scale.value},
    ],
  }));

  const now = Date.now();

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.searchRow}>
        <TextInput
          testID="memory-explorer-search"
          mode="outlined"
          dense
          placeholder={l10n.screenTitles.memoryExplorer + '…'}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
        <IconButton
          testID="memory-explorer-activity-feed-button"
          icon="history"
          mode="contained-tonal"
          accessibilityLabel={l10n.components.memoryExplorer.activityFeedButton}
          onPress={() => setIsActivityFeedVisible(true)}
        />
      </View>

      <View style={styles.legendRow}>
        <Text variant="labelSmall" style={styles.legendText}>
          {l10n.components.memoryExplorer.legend}
        </Text>
      </View>

      <View style={styles.canvasContainer} testID="memory-explorer-canvas">
        {visibleNodes.length === 0 ? (
          <View style={styles.emptyState}>
            <Text variant="bodyMedium" style={styles.legendText}>
              {l10n.components.memoryExplorer.empty}
            </Text>
          </View>
        ) : (
          <GestureDetector gesture={composedGesture}>
            <Animated.View
              style={[{width: canvasWidth, height: canvasHeight}, canvasStyle]}>
              <Svg width={canvasWidth} height={canvasHeight}>
                {visibleEdges.map(edge => {
                  const from = positions.get(edge.sourceNodeId);
                  const to = positions.get(edge.targetNodeId);
                  if (!from || !to) {
                    return null;
                  }
                  const isContradiction = edge.relation === 'CONTRADICTS';
                  return (
                    <Line
                      key={edge.id}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={
                        isContradiction ? '#E53935' : theme.colors.outline
                      }
                      strokeWidth={1 + edge.weight}
                      strokeDasharray={isContradiction ? '4,4' : undefined}
                      opacity={0.6}
                    />
                  );
                })}
                {visibleNodes.map(node => {
                  const pos = positions.get(node.id);
                  if (!pos) {
                    return null;
                  }
                  const matches = nodeMatchesQuery(node);
                  const baseOpacity = confidenceToOpacity(node.confidence);
                  const opacity = matches
                    ? baseOpacity
                    : baseOpacity * SEARCH_DIM_MULTIPLIER;
                  const ringColor = node.pinned
                    ? PINNED_RING_COLOR
                    : isRecentlyAccessed(node, now)
                      ? RECENT_RING_COLOR
                      : undefined;
                  return (
                    <Circle
                      key={node.id}
                      testID={`memory-node-${node.id}`}
                      cx={pos.x}
                      cy={pos.y}
                      r={salienceToRadius(node.salience)}
                      fill={valenceToColor(node.valence)}
                      fillOpacity={opacity}
                      stroke={ringColor}
                      strokeWidth={ringColor ? 3 : 0}
                      onPress={() => setSelectedNodeId(node.id)}
                    />
                  );
                })}
              </Svg>
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      <Sheet
        isVisible={!!selectedNode}
        onClose={() => setSelectedNodeId(undefined)}
        title={selectedNode?.label}>
        {selectedNode && (
          <Sheet.View style={styles.detailContent}>
            <Text variant="bodyMedium" style={styles.detailRow}>
              {l10n.components.memoryExplorer.detailKind}: {selectedNode.kind} (
              {selectedNode.memoryType})
            </Text>
            {selectedNode.description && (
              <Text variant="bodyMedium" style={styles.detailRow}>
                {selectedNode.description}
              </Text>
            )}
            <Text variant="bodySmall" style={styles.detailRow}>
              {l10n.components.memoryExplorer.detailConfidence}:{' '}
              {selectedNode.confidence.toFixed(2)}
            </Text>
            <Text variant="bodySmall" style={styles.detailRow}>
              {l10n.components.memoryExplorer.detailValence}:{' '}
              {selectedNode.valence !== undefined
                ? selectedNode.valence.toFixed(2)
                : l10n.components.memoryExplorer.detailUnscored}
            </Text>
            <Text variant="bodySmall" style={styles.detailRow}>
              {l10n.components.memoryExplorer.detailSalience}:{' '}
              {selectedNode.salience !== undefined
                ? selectedNode.salience.toFixed(2)
                : l10n.components.memoryExplorer.detailUnscored}
            </Text>
            <Text variant="bodySmall" style={styles.detailRow}>
              {l10n.components.memoryExplorer.detailProvenance}:{' '}
              {selectedNode.provenance}
            </Text>
            {selectedCompartment && (
              <Text variant="bodySmall" style={styles.detailRow}>
                {l10n.components.memoryExplorer.detailCompartment}:{' '}
                {selectedCompartment.name}
              </Text>
            )}
            {selectedNode.pinned && (
              <Text variant="bodySmall" style={styles.detailRow}>
                {l10n.components.memoryExplorer.detailPinned}
              </Text>
            )}
          </Sheet.View>
        )}
      </Sheet>

      <Sheet
        isVisible={isActivityFeedVisible}
        onClose={() => setIsActivityFeedVisible(false)}
        title={l10n.components.memoryExplorer.activityFeedTitle}>
        <Sheet.View style={styles.activityFeedContent}>
          <ScrollView
            testID="memory-explorer-activity-log-scroll"
            style={styles.logScrollContainer}>
            {activityEntries.length === 0 ? (
              <Text variant="labelSmall" style={styles.logText}>
                {l10n.components.memoryExplorer.activityFeedEmpty}
              </Text>
            ) : (
              activityEntries
                .slice()
                .reverse()
                .map((entry, index) => (
                  <Text
                    key={`${entry.ts}-${index}`}
                    variant="labelSmall"
                    style={styles.logText}>
                    {`${new Date(entry.ts).toLocaleTimeString()}  ${
                      entry.message
                    }`}
                  </Text>
                ))
            )}
          </ScrollView>
          <View style={styles.logButtonRow}>
            <Button
              testID="memory-explorer-activity-clear-button"
              mode="text"
              onPress={handleClearActivityLog}
              disabled={activityEntries.length === 0}>
              {l10n.common.clear}
            </Button>
            <Button
              testID="memory-explorer-activity-copy-button"
              mode="outlined"
              onPress={handleCopyActivityLog}
              disabled={activityEntries.length === 0}>
              {l10n.components.memoryExplorer.activityFeedCopyButton}
            </Button>
          </View>
        </Sheet.View>
      </Sheet>
    </SafeAreaView>
  );
};
