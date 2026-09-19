import React, {useContext} from 'react';
import {View, Platform, Alert} from 'react-native';

import {observer} from 'mobx-react-lite';
import {Text, Card, Button, Switch} from 'react-native-paper';
import {pick, types} from '@react-native-documents/picker';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {Divider} from '../../components';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {memorySettingsStore} from '../../store';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';

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

export const MemorySettingsSection = observer(() => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);

  const fileName = memorySettingsStore.embeddingModelPath?.split('/').pop();

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
        </View>
      </Card.Content>
    </Card>
  );
});
