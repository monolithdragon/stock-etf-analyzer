/**
 * Portfólió képernyő (PHASE 12). Adat: `analyzePortfolio` use case (PHASE 09).
 * KÜLÖN logika: `buildPortfolioViewModel`. MVP: egyetlen portfólió (`main`), memóriában
 * (tartós tárolás: PHASE 13).
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { buildPortfolioAiInput } from '@/application';
import { BulletList, Disclaimers } from '@/presentation/analysis/evaluation-sections';
import { ExplanationSection } from '@/presentation/analysis/explanation-section';
import {
  AppText,
  Card,
  DataNotices,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  MetricRow,
  MetricRows,
  Screen,
  SecondaryButton,
  Section,
  StatusBadge,
  WeightBars,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useAsyncResult } from '@/presentation/hooks/use-async-result';
import { useDataStatus } from '@/presentation/hooks/use-data-status';
import { useSettings } from '@/presentation/state/settings-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import {
  buildPortfolioViewModel,
  type SignedValue,
} from '@/presentation/view-models/portfolio-view-model';

import { AddTransactionForm, CreatePortfolioForm } from './portfolio-forms';

/** MVP: egyetlen portfólió. */
export const MAIN_PORTFOLIO_ID = 'main';

function Signed({ label, value }: { readonly label: string; readonly value: SignedValue }) {
  const theme = useTheme();
  const a11y = [label, value.text, value.directionText].filter((x) => x !== null).join(', ');
  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing.md,
      }}>
      <AppText tone="textSecondary" style={{ flexShrink: 1 }}>
        {label}
      </AppText>
      {value.tone === 'neutral' ? (
        <AppText variant="number">{value.text}</AppText>
      ) : (
        <StatusBadge tone={value.tone} label={value.text} />
      )}
    </View>
  );
}

export function PortfolioScreen() {
  const theme = useTheme();
  const services = useAppServices();
  const { settings } = useSettings();
  const [withHistory, setWithHistory] = useState(false);
  const { state, reload, refreshing } = useAsyncResult(
    () => services.analyzePortfolio(MAIN_PORTFOLIO_ID, { history: { enabled: withHistory } }),
    [services, withHistory],
  );
  const listingIds = useMemo(
    () => (state.status === 'success' ? state.data.positions.map((p) => p.listingId) : []),
    [state],
  );
  // PHASE 13: az árfolyamok cache-ből/offline tartalékból is jöhetnek – az időpont mindig látszik.
  // A portfólió (tranzakciók) teljesen lokális; a lehúzás az árfolyamokat frissíti (kézi frissítés).
  const { notices: dataNotices, manualRefresh } = useDataStatus(
    listingIds,
    state.status === 'success' ? state : null,
    reload,
  );
  const model = useMemo(
    () => (state.status === 'success' ? buildPortfolioViewModel(state.data) : null),
    [state],
  );
  const aiInput = useMemo(
    () =>
      state.status === 'success' && state.data.positions.length > 0
        ? buildPortfolioAiInput(state.data)
        : null,
    [state],
  );

  if (state.status === 'loading') {
    return (
      <Screen>
        <LoadingState label={strings.portfolio.loading} />
      </Screen>
    );
  }
  if (state.status === 'error') {
    if (state.error.kind === 'NOT_FOUND') {
      return (
        <Screen>
          <EmptyState
            title={strings.portfolio.emptyTitle}
            message={strings.portfolio.emptyMessage}
            action={
              <CreatePortfolioForm
                portfolioId={MAIN_PORTFOLIO_ID}
                defaultCurrency={settings.baseCurrency}
                onCreated={reload}
              />
            }
          />
        </Screen>
      );
    }
    return (
      <Screen onRefresh={manualRefresh}>
        <ErrorState error={state.error} onRetry={manualRefresh} />
      </Screen>
    );
  }
  if (model === null) return null;

  const hasPositions = model.positions.length > 0;
  return (
    <Screen onRefresh={manualRefresh} refreshing={refreshing} testID="portfolio-screen">
      <AppText variant="title" accessibilityRole="header">
        {model.header.title}
      </AppText>
      <AppText tone="textSecondary">{`${strings.portfolio.baseCurrencyLabel}: ${model.header.baseCurrency}`}</AppText>
      <DataNotices notices={[...dataNotices, ...model.notices]} />

      {!hasPositions ? (
        <EmptyState title={strings.portfolio.noTxTitle} message={strings.portfolio.noTxMessage} />
      ) : (
        <>
          <Card
            title={strings.portfolio.summaryTitle}
            subtitle={model.summary.positionsText}
            testID="portfolio-summary">
            <MetricRow row={model.summary.marketValue} />
            <Signed label={strings.portfolio.unrealized} value={model.summary.unrealized} />
            <Signed label={strings.portfolio.totalReturn} value={model.summary.totalReturn} />
            <Signed label={strings.portfolio.totalReturnPct} value={model.summary.totalReturnPct} />
            <AppText variant="caption" tone="textSecondary">
              {strings.portfolio.baseViewNote}
            </AppText>
          </Card>

          <Section
            title={strings.portfolio.positionsTitle}
            summary={model.summary.positionsText}
            initiallyOpen
            testID="section-positions">
            {model.positions.map((p) => (
              <View
                key={p.listingId}
                style={{
                  gap: theme.spacing.xs,
                  paddingVertical: theme.spacing.sm,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                }}>
                <ListItem
                  title={p.title}
                  subtitle={`${p.subtitle} · ${p.statusText}`}
                  trailing={<AppText variant="number">{p.marketValueText}</AppText>}
                />
                <AppText
                  variant="caption"
                  tone="textSecondary">{`${strings.portfolio.weight}: ${p.weightText}`}</AppText>
                <Signed label={strings.portfolio.plBase} value={p.plBase} />
                <Signed label={strings.portfolio.plNative} value={p.plNative} />
                <Signed label={strings.portfolio.totalReturnPct} value={p.returnPct} />
                {p.fxText !== null && (
                  <AppText variant="caption" tone="textSecondary">
                    {p.fxText}
                  </AppText>
                )}
                <BulletList items={p.issues} />
              </View>
            ))}
          </Section>

          <Section title={strings.portfolio.detailsTitle} testID="section-totals">
            <MetricRows rows={model.summary.rows} />
          </Section>

          <Section
            title={strings.portfolio.allocationTitle}
            summary={`${model.allocation.length} ${strings.portfolio.positionsUnit}`}
            testID="section-allocation">
            {model.allocation.length > 0 ? (
              <WeightBars
                items={model.allocation}
                accessibilityLabel={strings.portfolio.allocationTitle}
              />
            ) : (
              <AppText variant="caption" tone="textSecondary">
                {strings.common.notAvailable}
              </AppText>
            )}
            {model.unpriced.length > 0 && (
              <>
                <AppText
                  variant="bodyStrong"
                  tone="warning">{`⚠ ${strings.portfolio.unpriced}`}</AppText>
                <BulletList items={model.unpriced} />
              </>
            )}
          </Section>

          <Section title={strings.portfolio.currencyTitle} testID="section-currency">
            {model.currencyExposure.items.length > 0 && (
              <WeightBars
                items={model.currencyExposure.items}
                accessibilityLabel={strings.portfolio.currencyTitle}
              />
            )}
            <AppText variant="caption" tone="textSecondary">
              {model.currencyExposure.note}
            </AppText>
          </Section>

          <Section title={strings.portfolio.concentrationTitle} testID="section-concentration">
            <MetricRows rows={model.concentration.rows} />
            <BulletList items={model.concentration.notes} />
          </Section>

          <Section title={strings.portfolio.overlapTitle} testID="section-overlap">
            {model.overlap.lines.length > 0 ? (
              <BulletList items={model.overlap.lines} />
            ) : (
              <AppText variant="caption">{strings.portfolio.overlapNone}</AppText>
            )}
            <AppText variant="caption" tone="textSecondary">
              {model.overlap.note}
            </AppText>
          </Section>

          <Section
            title={strings.portfolio.riskTitle}
            summary={model.risk.statusText}
            testID="section-portfolio-risk">
            <AppText variant="caption">{model.risk.statusText}</AppText>
            {!withHistory && (
              <SecondaryButton
                label={strings.portfolio.computeHistory}
                accessibilityHint={strings.portfolio.computeHistoryHint}
                onPress={() => setWithHistory(true)}
              />
            )}
            <MetricRows rows={model.risk.rows} />
            <BulletList items={model.risk.notes} />
          </Section>

          {aiInput !== null && aiInput.ok && (
            <ExplanationSection input={aiInput.value} requiresConsent />
          )}
          {aiInput !== null && !aiInput.ok && <ErrorState error={aiInput.error} />}
        </>
      )}

      <Section
        title={strings.portfolio.addTxTitle}
        initiallyOpen={!hasPositions}
        testID="section-add-tx">
        <AddTransactionForm portfolioId={MAIN_PORTFOLIO_ID} onRecorded={reload} />
      </Section>

      <Card title={strings.portfolio.accountingTitle}>
        <AppText variant="caption">{model.accounting.description}</AppText>
        <AppText variant="caption" tone="warning">{`⚠ ${model.accounting.taxWarning}`}</AppText>
        {model.validationIssues.length > 0 && (
          <>
            <AppText
              variant="bodyStrong"
              tone="negative">{`⚠ ${strings.portfolio.validationIssues}`}</AppText>
            <BulletList items={model.validationIssues} />
          </>
        )}
        <BulletList items={model.warnings} />
        {model.fxRates.length > 0 && (
          <>
            <AppText variant="bodyStrong">{strings.portfolio.fxRates}</AppText>
            <BulletList items={model.fxRates} />
          </>
        )}
      </Card>
      <Disclaimers items={[model.disclaimer]} />
    </Screen>
  );
}
