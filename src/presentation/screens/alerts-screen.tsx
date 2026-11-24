/**
 * Riasztások (PHASE 14, D-088). Szabályok tárolása és kiértékelése CSAK az alkalmazáson belül:
 * a képernyő megnyitásakor (a tárolt utolsó állapot látszik) és az „Ellenőrzés most” gombra.
 * Push- vagy rendszerértesítés NINCS – a korlátok a képernyő tetején láthatók.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  ALERT_METRIC_INFO,
  ALERT_METRICS,
  ALERT_PLATFORM_LIMITATIONS,
  type AlertCheckReport,
  type AlertComparator,
  type AlertMetric,
  type AlertRule,
} from '@/application';
import type { AppError } from '@/domain';
import {
  AppText,
  Card,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  InfoRow,
  ListItem,
  MetricRows,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Section,
  StatusBadge,
  TextField,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { formatDateTime } from '@/presentation/format';
import { useSettings } from '@/presentation/state/settings-context';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import {
  buildAlertRow,
  inputUnitHint,
  parseThresholdInput,
} from '@/presentation/view-models/insights-view-model';

export function AlertsScreen() {
  const theme = useTheme();
  const services = useAppServices();
  const { settings } = useSettings();
  const watchlist = useWatchlist();
  const candidates = watchlist.items.filter((i) => i.kind !== 'unknown');

  const [rules, setRules] = useState<readonly AlertRule[]>([]);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [report, setReport] = useState<AlertCheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [listingId, setListingId] = useState<string | null>(null);
  const [metric, setMetric] = useState<AlertMetric>('price');
  const [comparator, setComparator] = useState<AlertComparator>('above');
  const [threshold, setThreshold] = useState('');
  const [currency, setCurrency] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    const listed = await services.alerts.list();
    if (listed.ok) {
      setRules(listed.value);
      setLoadError(null);
    } else {
      setLoadError(listed.error);
    }
  }, [services]);

  // Megnyitáskor a tárolt szabályok és utolsó állapotuk (hálózati lekérés nélkül).
  useEffect(() => {
    let active = true;
    services.alerts
      .list()
      .then((listed) => {
        if (!active) return;
        if (listed.ok) setRules(listed.value);
        else setLoadError(listed.error);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services]);

  const selected = candidates.find((i) => i.listingId === listingId) ?? candidates[0] ?? null;
  const metrics = ALERT_METRICS.filter(
    (m) => selected !== null && ALERT_METRIC_INFO[m].appliesTo.some((k) => k === selected.kind),
  );
  const activeMetric = metrics.includes(metric) ? metric : 'price';
  const info = ALERT_METRIC_INFO[activeMetric];

  const submit = () => {
    if (selected === null) return;
    setSaved(false);
    services.alerts
      .add({
        listingId: selected.listingId,
        kind: selected.kind,
        metric: activeMetric,
        comparator,
        threshold: parseThresholdInput(threshold, info.unit),
        currency: activeMetric === 'price' ? currency.trim() : null,
      })
      .then(async (result) => {
        if (!result.ok) {
          setFormError(result.error.message);
          return;
        }
        setFormError(null);
        setThreshold('');
        setSaved(true);
        await reload();
      })
      .catch(() => undefined);
  };

  const check = () => {
    setChecking(true);
    services.alerts
      .checkNow({ displayCurrency: settings.baseCurrency })
      .then(async (result) => {
        setChecking(false);
        if (result.ok) setReport(result.value);
        else setLoadError(result.error);
        await reload();
      })
      .catch(() => setChecking(false));
  };

  const rows = useMemo(
    () =>
      rules.map((rule) =>
        buildAlertRow(rule, report?.results.find((r) => r.ruleId === rule.id) ?? null),
      ),
    [rules, report],
  );

  return (
    <Screen testID="alerts-screen">
      <Card title={strings.alerts.title} subtitle={strings.alerts.subtitle}>
        <Section
          title={strings.alerts.limitationsTitle}
          summary={`${ALERT_PLATFORM_LIMITATIONS.length}`}
          initiallyOpen
          testID="alerts-limitations">
          {ALERT_PLATFORM_LIMITATIONS.map((line) => (
            <AppText key={line} variant="caption">{`• ${line}`}</AppText>
          ))}
        </Section>
      </Card>
      {loadError !== null && <ErrorState error={loadError} onRetry={() => void reload()} />}
      <Card title={`${strings.alerts.listTitle} (${rules.length})`} testID="alerts-list">
        {rules.length === 0 && <AppText tone="textSecondary">{strings.alerts.empty}</AppText>}
        {report !== null && (
          <View style={{ gap: theme.spacing.xs }}>
            <InfoRow label={strings.alerts.checkedAt} value={formatDateTime(report.evaluatedAt)} />
            <InfoRow label={strings.alerts.analysesLoaded} value={String(report.analysesLoaded)} />
            {report.newlyTriggered.length > 0 && (
              <StatusBadge
                label={`${strings.alerts.newlyTriggered}: ${report.newlyTriggered.length}`}
                tone="warning"
              />
            )}
          </View>
        )}
        {rows.map((row) => (
          <View
            key={row.key}
            testID={`alert-row-${row.key}`}
            style={{
              gap: theme.spacing.xs,
              paddingVertical: theme.spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}>
            <ListItem title={row.title} subtitle={row.subtitle} />
            {row.badge !== null && <StatusBadge label={row.badge.label} tone={row.badge.tone} />}
            {row.observed !== null && <MetricRows rows={[row.observed]} />}
            {row.lines.map((line) => (
              <AppText key={line} variant="caption" tone="textSecondary">
                {line}
              </AppText>
            ))}
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              <SecondaryButton
                compact
                label={row.enabled ? strings.alerts.disable : strings.alerts.enable}
                onPress={() =>
                  void services.alerts.setEnabled(row.key, !row.enabled).then(() => reload())
                }
              />
              <SecondaryButton
                compact
                label={strings.alerts.remove}
                accessibilityLabel={`${strings.alerts.remove}: ${row.title}`}
                onPress={() => void services.alerts.remove(row.key).then(() => reload())}
              />
            </View>
          </View>
        ))}
        {rules.length > 0 && (
          <PrimaryButton
            label={checking ? strings.alerts.checking : strings.alerts.check}
            accessibilityHint={strings.alerts.checkHint}
            disabled={checking}
            onPress={check}
          />
        )}
      </Card>
      <Card title={strings.alerts.addTitle}>
        {selected === null ? (
          <EmptyState title={strings.alerts.addTitle} message={strings.alerts.needWatchlist} />
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="textSecondary">
              {strings.alerts.listing}
            </AppText>
            <ChoiceGroup
              label={strings.alerts.listing}
              options={candidates.map((i) => ({ value: i.listingId, label: i.listingId }))}
              value={selected.listingId}
              onChange={setListingId}
            />
            <ChoiceGroup
              label={strings.alerts.metric}
              options={metrics.map((m) => ({ value: m, label: ALERT_METRIC_INFO[m].label }))}
              value={activeMetric}
              onChange={setMetric}
            />
            <ChoiceGroup
              label={strings.alerts.comparator}
              options={[
                { value: 'above', label: strings.alerts.above },
                { value: 'below', label: strings.alerts.below },
              ]}
              value={comparator}
              onChange={setComparator}
            />
            <TextField
              label={`${strings.alerts.threshold} – ${inputUnitHint(info.unit)}`}
              value={threshold}
              onChangeText={setThreshold}
              keyboardType="decimal-pad"
              error={formError}
            />
            {activeMetric === 'price' && (
              <TextField
                label={strings.alerts.currency}
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                maxLength={3}
              />
            )}
            <SecondaryButton label={strings.alerts.add} onPress={submit} />
            {saved && (
              <AppText variant="caption" tone="positive" accessibilityLiveRegion="polite">
                {strings.alerts.saved}
              </AppText>
            )}
          </View>
        )}
      </Card>
    </Screen>
  );
}
