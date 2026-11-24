/**
 * Összehasonlítás (PHASE 14). Kiválasztás a figyelőlistáról (2–4 elem), majd `compareListings`.
 * Csak összehasonlítható mutatók látszanak (a szabályokat az application réteg alkalmazza);
 * a kimaradt mutatók okkal listázva. Mobilon mutatónként függőleges cellák (nincs széles tábla).
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { MAX_COMPARE, MIN_COMPARE, type CompareOutcome } from '@/application';
import type { AppError } from '@/domain';
import {
  AppText,
  Card,
  DetailList,
  EmptyState,
  ErrorState,
  InfoRow,
  LoadingState,
  MetricRows,
  PrimaryButton,
  Screen,
  Section,
  StatusBadge,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useSettings } from '@/presentation/state/settings-context';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import {
  buildComparisonViewModel,
  KIND_LABEL,
} from '@/presentation/view-models/insights-view-model';

type RunState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: AppError }
  | { readonly status: 'success'; readonly data: CompareOutcome };

function SelectRow({
  label,
  subtitle,
  checked,
  disabled,
  onToggle,
}: {
  readonly label: string;
  readonly subtitle: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={`${label}, ${subtitle}`}
      disabled={disabled}
      onPress={onToggle}
      style={{
        minHeight: theme.minTouchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        opacity: disabled ? 0.5 : 1,
      }}>
      <AppText variant="bodyStrong" tone={checked ? 'primary' : 'textSecondary'}>
        {checked ? '☑' : '☐'}
      </AppText>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" tone="textSecondary">
          {subtitle}
        </AppText>
      </View>
    </Pressable>
  );
}

export function CompareScreen() {
  const theme = useTheme();
  const services = useAppServices();
  const { settings } = useSettings();
  const watchlist = useWatchlist();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [run, setRun] = useState<RunState>({ status: 'idle' });

  const toggle = (listingId: string) =>
    setSelected((current) =>
      current.includes(listingId)
        ? current.filter((id) => id !== listingId)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, listingId],
    );

  const start = () => {
    const targets = watchlist.items.filter((i) => selected.includes(i.listingId));
    setRun({ status: 'loading' });
    services
      .compareListings(targets, { displayCurrency: settings.baseCurrency })
      .then((result) =>
        setRun(
          result.ok
            ? { status: 'success', data: result.value }
            : { status: 'error', error: result.error },
        ),
      )
      .catch(() => undefined);
  };

  const model = useMemo(
    () => (run.status === 'success' ? buildComparisonViewModel(run.data.comparison) : null),
    [run],
  );
  const failedLoads =
    run.status === 'success' ? run.data.loads.filter((l) => l.error !== null) : [];
  const canRun = selected.length >= MIN_COMPARE && selected.length <= MAX_COMPARE;

  return (
    <Screen testID="compare-screen">
      <Card title={strings.compare.title} subtitle={strings.compare.subtitle}>
        <AppText variant="caption">{strings.compare.rules}</AppText>
      </Card>
      {watchlist.items.length < MIN_COMPARE ? (
        <EmptyState title={strings.watchlist.emptyTitle} message={strings.compare.empty} />
      ) : (
        <Card title={`${strings.compare.selectTitle} (${selected.length}/${MAX_COMPARE})`}>
          {watchlist.items.map((item) => (
            <SelectRow
              key={item.listingId}
              label={item.name ?? item.listingId}
              subtitle={
                item.kind === 'unknown'
                  ? `${item.listingId} · ${strings.compare.unknownKind}`
                  : `${item.listingId} · ${KIND_LABEL[item.kind]}`
              }
              checked={selected.includes(item.listingId)}
              disabled={
                item.kind === 'unknown' ||
                (!selected.includes(item.listingId) && selected.length >= MAX_COMPARE)
              }
              onToggle={() => toggle(item.listingId)}
            />
          ))}
          {!canRun && (
            <AppText variant="caption" tone="textSecondary">
              {strings.compare.needTwo}
            </AppText>
          )}
          <PrimaryButton
            label={strings.compare.run}
            accessibilityHint={strings.compare.runHint}
            disabled={!canRun || run.status === 'loading'}
            onPress={start}
          />
        </Card>
      )}
      {run.status === 'loading' && <LoadingState label={strings.compare.loading} />}
      {run.status === 'error' && <ErrorState error={run.error} onRetry={start} />}
      {model !== null && (
        <>
          <Card title={strings.compare.tableTitle} subtitle={model.modeText} testID="compare-table">
            {model.groups.length === 0 && (
              <AppText tone="textSecondary">{strings.compare.noRows}</AppText>
            )}
            {model.groups.map((group) => (
              <View key={group.title} style={{ gap: theme.spacing.sm }}>
                <AppText variant="subheading">{group.title}</AppText>
                {group.rows.map((row) => (
                  <View
                    key={row.key}
                    testID={`compare-row-${row.key}`}
                    style={{
                      gap: theme.spacing.xs,
                      padding: theme.spacing.sm,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surfaceMuted,
                    }}>
                    <AppText variant="bodyStrong">{row.label}</AppText>
                    <MetricRows rows={row.cells.map((c) => c.row)} />
                    {row.notes.map((note) => (
                      <AppText key={note} variant="caption" tone="textSecondary">
                        {`ℹ ${note}`}
                      </AppText>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            {model.notes.map((note) => (
              <AppText key={note} variant="caption" tone="textSecondary">
                {note}
              </AppText>
            ))}
          </Card>
          {model.overlaps.length > 0 && (
            <Card title={strings.compare.overlapTitle} testID="compare-overlap">
              {model.overlaps.map((o) => (
                <View key={o.key} style={{ gap: theme.spacing.xs }}>
                  <AppText variant="bodyStrong">{o.title}</AppText>
                  <StatusBadge label={o.statusText} tone={o.ok ? 'info' : 'warning'} />
                  {o.lines.map((line) => (
                    <InfoRow key={line.label} label={line.label} value={line.value} />
                  ))}
                  {o.topCommon.length > 0 && (
                    <>
                      <AppText variant="caption" tone="textSecondary">
                        {strings.compare.topCommon}
                      </AppText>
                      <DetailList lines={o.topCommon} />
                    </>
                  )}
                  {o.notes.map((note) => (
                    <AppText key={note} variant="caption" tone="textSecondary">
                      {`ℹ ${note}`}
                    </AppText>
                  ))}
                </View>
              ))}
            </Card>
          )}
          {model.exposures.length > 0 && (
            <Card title={strings.compare.exposureTitle}>
              <MetricRows rows={model.exposures} />
            </Card>
          )}
          <Section
            title={strings.compare.excludedTitle}
            summary={`${model.excluded.length}`}
            testID="compare-excluded">
            <DetailList lines={model.excluded.map((e) => ({ label: e.label, value: e.reason }))} />
          </Section>
          {failedLoads.length > 0 && (
            <Card title={strings.compare.loadIssues}>
              <DetailList
                lines={failedLoads.map((l) => ({
                  label: l.target.listingId,
                  value: l.error?.message ?? '',
                }))}
              />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
