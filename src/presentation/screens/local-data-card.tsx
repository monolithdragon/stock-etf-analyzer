/**
 * „Helyi adatok” kártya a Beállításokban (PHASE 13): tárolás módja, cache-állapot,
 * cache-INVALIDÁLÁS (törlés), saját adatok exportja (JSON, kijelölhető szöveg) és teljes
 * törlés kétlépcsős megerősítéssel. Minden művelet use case-en át (`services.localData`).
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { serializeUserDataExport, type CacheStats } from '@/application';
import { AppText, Card, InfoRow, SecondaryButton } from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { formatDateTime } from '@/presentation/format';
import { useSettings } from '@/presentation/state/settings-context';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

type Feedback = { readonly tone: 'positive' | 'negative'; readonly text: string } | null;

export function LocalDataCard({ persistent }: { readonly persistent: boolean }) {
  const theme = useTheme();
  const services = useAppServices();
  const { resetToDefaults } = useSettings();
  const watchlist = useWatchlist();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadStats = useCallback(() => {
    services.localData
      .cacheStats()
      .then((result) => setStats(result.ok ? result.value : null))
      .catch(() => undefined);
  }, [services]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const fail = (message: string) =>
    setFeedback({ tone: 'negative', text: `${strings.settings.operationFailed}: ${message}` });

  const clearCache = async () => {
    const result = await services.localData.clearCache();
    if (!result.ok) return fail(result.error.message);
    setFeedback({
      tone: 'positive',
      text: `${strings.settings.clearCacheDone} (${result.value}).`,
    });
    loadStats();
  };

  const exportData = async () => {
    const result = await services.localData.exportUserData();
    if (!result.ok) return fail(result.error.message);
    setExportText(serializeUserDataExport(result.value));
  };

  const deleteAll = async () => {
    setConfirmDelete(false);
    const result = await services.localData.deleteAllLocalData();
    if (!result.ok) return fail(result.error.message);
    resetToDefaults();
    watchlist.clearLocal();
    setExportText(null);
    setFeedback({ tone: 'positive', text: strings.settings.deleteAllDone });
    loadStats();
  };

  return (
    <Card title={strings.settings.localDataTitle} subtitle={strings.settings.localDataHint}>
      <AppText variant="caption">
        {persistent ? strings.settings.persistentYes : strings.settings.persistentNo}
      </AppText>
      {stats === null ? (
        <AppText variant="caption" tone="textSecondary">
          {strings.settings.cacheNone}
        </AppText>
      ) : (
        <>
          <InfoRow label={strings.settings.cacheEntries} value={String(stats.entryCount)} />
          <InfoRow
            label={strings.settings.cacheOldest}
            value={formatDateTime(stats.oldestFetchedAt)}
          />
        </>
      )}
      <View style={{ gap: theme.spacing.sm }}>
        <SecondaryButton
          testID="clear-cache"
          label={strings.settings.clearCache}
          onPress={() => void clearCache()}
        />
        <SecondaryButton
          testID="export-data"
          label={strings.settings.exportButton}
          onPress={() => void exportData()}
        />
        {exportText !== null && (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="textSecondary">
              {strings.settings.exportHint}
            </AppText>
            <Text
              testID="export-json"
              selectable
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: theme.colors.text,
                backgroundColor: theme.colors.surfaceMuted,
                padding: theme.spacing.sm,
                borderRadius: theme.radius.md,
              }}>
              {exportText}
            </Text>
          </View>
        )}
        {confirmDelete ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText tone="warning">{`⚠ ${strings.settings.deleteAllWarning}`}</AppText>
            <SecondaryButton
              testID="delete-all-confirm"
              label={strings.settings.deleteAllConfirm}
              onPress={() => void deleteAll()}
            />
            <SecondaryButton
              label={strings.settings.deleteAllCancel}
              onPress={() => setConfirmDelete(false)}
            />
          </View>
        ) : (
          <SecondaryButton
            testID="delete-all"
            label={strings.settings.deleteAll}
            onPress={() => setConfirmDelete(true)}
          />
        )}
      </View>
      {feedback !== null && (
        <AppText tone={feedback.tone} accessibilityLiveRegion="polite">
          {feedback.text}
        </AppText>
      )}
    </Card>
  );
}
