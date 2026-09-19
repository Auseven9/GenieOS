import React, {useContext, useEffect, useState, useCallback} from 'react';
import {View, Platform, Alert, ScrollView} from 'react-native';

import {observer} from 'mobx-react-lite';
import {Text, Card, Button, Switch, SegmentedButtons} from 'react-native-paper';
import {pick, types} from '@react-native-documents/picker';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';
import {useNavigation, ParamListBase} from '@react-navigation/native';
import {DrawerNavigationProp} from '@react-navigation/drawer';

import {Divider} from '../../components';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {memorySettingsStore} from '../../store';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {ROUTES} from '../../utils/navigationConstants';
import {
  IDLE_SWEEP_INTERVAL_HOURS_OPTIONS,
  type IdleSweepIntervalHours,
} from '../../repositories/MemorySettingsRepository';
import {forceRunIdleSweep} from '../../services/memory/MemorySweepScheduler';
import {getWorldviewSummary} from '../../services/memory/MemorySweepPipeline';
import {
  getSweepLog,
  clearSweepLog,
  type SweepLogEntry,
} from '../../services/memory/MemorySweepLog';
import {ensureNotificationPermission} from '../../services/notifications/SweepNotificationService';

// Separate from models/local (full chat models added via ModelsScreen) —
// an embedding-only GGUF has no chat template/capabilities and does not
// belong in ModelStore's registered model list, so it gets its own folder
// rather than being registered there.
const EMBEDDING_MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models/embedding`;

function isUserCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as {code?: string}).code === 'DOCUMENT_PICKER_CANCELED'
  );
}

// A small, local relative-time phrase rather than utils/formatters.ts's
// timeAgo(): that helper's output is wired to the "Updated {{time}} ago"
// model-search sentence, not reusable as a bare fragment here.
function relativeTimeAgo(
  epochMs: number,
  units: Record<string, string>,
): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} ${days > 1 ? units.days : units.day} ago`;
  }
  if (hours > 0) {
    return `${hours} ${hours > 1 ? units.hours : units.hour} ago`;
  }
  if (minutes > 0) {
    return `${minutes} ${minutes > 1 ? units.minutes : units.minute} ago`;
  }
  return units.justNow;
}

type SettingsNavigationProp = DrawerNavigationProp<ParamListBase>;

export const MemorySettingsSection = observer(() => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);
  const navigation = useNavigation<SettingsNavigationProp>();

  const fileName = memorySettingsStore.embeddingModelPath?.split('/').pop();

  const [worldviewSummary, setWorldviewSummary] = useState<string | undefined>(
    undefined,
  );
  const [isSweeping, setIsSweeping] = useState(false);
  const [logEntries, setLogEntries] = useState<SweepLogEntry[]>([]);

  const refreshWorldviewSummary = useCallback(() => {
    getWorldviewSummary()
      .then(setWorldviewSummary)
      .catch(() => {
        // getWorldviewSummary already logs; nothing more to do here.
      });
  }, []);

  const refreshLog = useCallback(() => {
    getSweepLog()
      .then(setLogEntries)
      .catch(() => {
        // getSweepLog already logs; nothing more to do here.
      });
  }, []);

  useEffect(() => {
    refreshWorldviewSummary();
    refreshLog();
  }, [refreshWorldviewSummary, refreshLog]);

  const handlePickEmbeddingModel = async () => {
    try {
      const [file] = await pick({
        type: Platform.OS === 'ios' ? 'public.data' : types.allFiles,
      });
      if (!file) {
        return;
      }

      const pickedName =
        file.name || file.uri.split('/').pop() || 'embedding-model.gguf';

      if (!(await RNFS.exists(EMBEDDING_MODELS_DIR))) {
        await RNFS.mkdir(EMBEDDING_MODELS_DIR);
      }
      const permanentPath = `${EMBEDDING_MODELS_DIR}/${pickedName}`;
      await RNFS.copyFile(file.uri, permanentPath);
      await memorySettingsStore.setEmbeddingModelPath(permanentPath);
    } catch (error) {
      if (isUserCancellation(error)) {
        return;
      }
      console.error(
        'MemorySettingsSection: failed to select embedding model:',
        error,
      );
      Alert.alert('', l10n.settings.memoryEmbeddingModelCopyError);
    }
  };

  const handleRunSweepNow = async () => {
    setIsSweeping(true);
    try {
      await forceRunIdleSweep();
      refreshWorldviewSummary();
      refreshLog();
    } finally {
      setIsSweeping(false);
    }
  };

  const handleCopyLog = () => {
    const logText = logEntries
      .map(entry => `${new Date(entry.ts).toLocaleString()}  ${entry.message}`)
      .join('\n');
    Clipboard.setString(logText);
    Alert.alert('', l10n.settings.memoryDiagnosticsCopiedMessage);
  };

  const handleClearLog = () => {
    Alert.alert(
      l10n.settings.memoryDiagnosticsClearConfirmTitle,
      l10n.settings.memoryDiagnosticsClearConfirmMessage,
      [
        {text: l10n.common.cancel, style: 'cancel'},
        {
          text: l10n.common.clear,
          style: 'destructive',
          onPress: () => {
            clearSweepLog().then(refreshLog);
          },
        },
      ],
    );
  };

  const handleToggleSweepNotifications = async (value: boolean) => {
    if (!value) {
      memorySettingsStore.setSweepNotificationsEnabled(false);
      return;
    }
    const granted = await ensureNotificationPermission();
    if (!granted) {
      Alert.alert(
        l10n.notifications.permissionTitle,
        l10n.notifications.permissionMessage,
      );
      return;
    }
    memorySettingsStore.setSweepNotificationsEnabled(true);
  };

  const intervalLabels: Record<IdleSweepIntervalHours, string> = {
    6: l10n.settings.memoryIdleSweepInterval6h,
    24: l10n.settings.memoryIdleSweepInterval24h,
    72: l10n.settings.memoryIdleSweepInterval72h,
    168: l10n.settings.memoryIdleSweepInterval168h,
  };

  const lastSweptText = memorySettingsStore.lastSweepAt
    ? t(l10n.settings.memoryIdleSweepLastRunLabel, {
        when: relativeTimeAgo(memorySettingsStore.lastSweepAt, {
          day: l10n.common.day,
          days: l10n.common.days,
          hour: l10n.common.hour,
          hours: l10n.common.hours,
          minute: l10n.common.minute,
          minutes: l10n.common.minutes,
          justNow: l10n.common.justNow,
        }),
      })
    : l10n.settings.memoryIdleSweepLastRunNever;

  return (
    <Card elevation={0} style={styles.card}>
      <Card.Title title={l10n.settings.memoryTitle} />
      <Card.Content>
        <View style={styles.settingItemContainer}>
          <View style={styles.switchContainer}>
            <View style={styles.textContainer}>
              <Text variant="titleMedium" style={styles.textLabel}>
                {l10n.settings.memoryEnabledLabel}
              </Text>
              <Text variant="labelSmall" style={styles.textDescription}>
                {l10n.settings.memoryEnabledDescription}
              </Text>
            </View>
            <Switch
              testID="memory-enabled-switch"
              value={memorySettingsStore.enabled}
              onValueChange={value => memorySettingsStore.setEnabled(value)}
            />
          </View>

          <Divider style={styles.divider} />

          <View style={styles.switchContainer}>
            <View style={styles.textContainer}>
              <Text variant="titleMedium" style={styles.textLabel}>
                {l10n.settings.memoryEmbeddingModelLabel}
              </Text>
              <Text variant="labelSmall" style={styles.textDescription}>
                {fileName
                  ? t(l10n.settings.memoryEmbeddingModelDescriptionSet, {
                      fileName,
                    })
                  : l10n.settings.memoryEmbeddingModelDescriptionUnset}
              </Text>
            </View>
            <Button
              testID="memory-embedding-model-select-button"
              mode="outlined"
              onPress={handlePickEmbeddingModel}
              style={styles.menuButton}>
              {fileName
                ? l10n.settings.memoryEmbeddingModelChangeButton
                : l10n.settings.memoryEmbeddingModelSelectButton}
            </Button>
          </View>

          {memorySettingsStore.enabled && (
            <>
              <Divider style={styles.divider} />

              <View style={styles.switchContainer}>
                <View style={styles.textContainer}>
                  <Text variant="titleMedium" style={styles.textLabel}>
                    {l10n.settings.memoryIdleSweepEnabledLabel}
                  </Text>
                  <Text variant="labelSmall" style={styles.textDescription}>
                    {Platform.OS === 'android'
                      ? l10n.settings.memoryIdleSweepEnabledDescriptionAndroid
                      : l10n.settings.memoryIdleSweepEnabledDescriptionIOS}
                  </Text>
                </View>
                <Switch
                  testID="memory-idle-sweep-enabled-switch"
                  value={memorySettingsStore.idleSweepEnabled}
                  onValueChange={value =>
                    memorySettingsStore.setIdleSweepEnabled(value)
                  }
                />
              </View>

              {memorySettingsStore.idleSweepEnabled && (
                <>
                  <View style={styles.fullRowControl}>
                    <Text variant="titleMedium" style={styles.textLabel}>
                      {l10n.settings.memoryIdleSweepIntervalLabel}
                    </Text>
                    <Text variant="labelSmall" style={styles.textDescription}>
                      {l10n.settings.memoryIdleSweepIntervalDescription}
                    </Text>
                    <SegmentedButtons
                      style={styles.segmentedButtons}
                      value={String(memorySettingsStore.idleSweepIntervalHours)}
                      onValueChange={value =>
                        memorySettingsStore.setIdleSweepIntervalHours(
                          Number(value) as IdleSweepIntervalHours,
                        )
                      }
                      density="medium"
                      buttons={IDLE_SWEEP_INTERVAL_HOURS_OPTIONS.map(hours => ({
                        value: String(hours),
                        label: intervalLabels[hours],
                      }))}
                    />
                  </View>

                  <View style={styles.switchContainer}>
                    <Text variant="labelSmall" style={styles.textDescription}>
                      {lastSweptText}
                    </Text>
                    <Button
                      testID="memory-idle-sweep-run-now-button"
                      mode="outlined"
                      loading={isSweeping}
                      disabled={isSweeping}
                      onPress={handleRunSweepNow}
                      style={styles.menuButton}>
                      {l10n.settings.memoryIdleSweepRunNowButton}
                    </Button>
                  </View>

                  <View style={styles.switchContainer}>
                    <View style={styles.textContainer}>
                      <Text variant="titleMedium" style={styles.textLabel}>
                        {l10n.settings.memorySweepNotificationsLabel}
                      </Text>
                      <Text variant="labelSmall" style={styles.textDescription}>
                        {l10n.settings.memorySweepNotificationsDescription}
                      </Text>
                    </View>
                    <Switch
                      testID="memory-sweep-notifications-switch"
                      value={memorySettingsStore.sweepNotificationsEnabled}
                      onValueChange={handleToggleSweepNotifications}
                    />
                  </View>
                </>
              )}

              <Divider style={styles.divider} />

              <View style={styles.settingItemContainer}>
                <Text variant="titleMedium" style={styles.textLabel}>
                  {l10n.settings.memoryWorldviewLabel}
                </Text>
                <Text variant="labelSmall" style={styles.textDescription}>
                  {worldviewSummary || l10n.settings.memoryWorldviewEmpty}
                </Text>
              </View>

              <Divider style={styles.divider} />

              <View style={styles.settingItemContainer}>
                <Text variant="titleMedium" style={styles.textLabel}>
                  {l10n.settings.memoryDiagnosticsLabel}
                </Text>
                <Text variant="labelSmall" style={styles.textDescription}>
                  {l10n.settings.memoryDiagnosticsDescription}
                </Text>
                <ScrollView
                  testID="memory-diagnostics-log-scroll"
                  style={styles.logScrollContainer}>
                  {logEntries.length === 0 ? (
                    <Text variant="labelSmall" style={styles.logText}>
                      {l10n.settings.memoryDiagnosticsEmpty}
                    </Text>
                  ) : (
                    logEntries
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
                    testID="memory-diagnostics-clear-button"
                    mode="text"
                    onPress={handleClearLog}
                    disabled={logEntries.length === 0}>
                    {l10n.common.clear}
                  </Button>
                  <Button
                    testID="memory-diagnostics-copy-button"
                    mode="outlined"
                    onPress={handleCopyLog}
                    disabled={logEntries.length === 0}>
                    {l10n.settings.memoryDiagnosticsCopyButton}
                  </Button>
                </View>
              </View>

              <Divider style={styles.divider} />

              <View style={styles.switchContainer}>
                <View style={styles.textContainer}>
                  <Text variant="titleMedium" style={styles.textLabel}>
                    {l10n.components.memoryExplorer.settingsRowLabel}
                  </Text>
                  <Text variant="labelSmall" style={styles.textDescription}>
                    {l10n.components.memoryExplorer.settingsRowDescription}
                  </Text>
                </View>
                <Button
                  testID="memory-explorer-open-button"
                  mode="outlined"
                  onPress={() => navigation.navigate(ROUTES.MEMORY_EXPLORER)}
                  style={styles.menuButton}>
                  {l10n.components.memoryExplorer.settingsRowButton}
                </Button>
              </View>
            </>
          )}
        </View>
      </Card.Content>
    </Card>
  );
});
