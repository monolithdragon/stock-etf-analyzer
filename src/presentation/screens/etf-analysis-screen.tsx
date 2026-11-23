/**
 * ETF-elemzés képernyő (PHASE 12). Adat: `evaluateEtf` use case (PHASE 08/10).
 * KÜLÖN logika a részvénytől: `buildEtfViewModel`.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { buildInstrumentAiInput } from '@/application';
import { AnalysisHeader, WatchlistToggle } from '@/presentation/analysis/analysis-header';
import {
  BulletList,
  DecisionCard,
  Disclaimers,
  EvaluationDetails,
} from '@/presentation/analysis/evaluation-sections';
import { ExplanationSection } from '@/presentation/analysis/explanation-section';
import {
  AppText,
  Card,
  DataNotices,
  ErrorState,
  LoadingState,
  MetricRows,
  Screen,
  SecondaryButton,
  Section,
  WeightBars,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useAsyncResult } from '@/presentation/hooks/use-async-result';
import { stockHref } from '@/presentation/navigation';
import { useSettings } from '@/presentation/state/settings-context';
import { strings } from '@/presentation/strings/hu';
import { buildEtfViewModel, type WeightBreakdown } from '@/presentation/view-models/etf-view-model';

function BreakdownSection({
  title,
  data,
  testID,
}: {
  readonly title: string;
  readonly data: WeightBreakdown;
  readonly testID: string;
}) {
  return (
    <Section
      title={title}
      summary={
        data.available ? `${data.items.length} ${strings.etf.groups}` : strings.common.notAvailable
      }
      testID={testID}>
      {data.available ? (
        <WeightBars items={data.items} accessibilityLabel={title} />
      ) : (
        <AppText variant="caption" tone="textSecondary">{`N/A – ${data.reason ?? ''}`}</AppText>
      )}
    </Section>
  );
}

export function EtfAnalysisScreen({ listingId }: { readonly listingId: string }) {
  const services = useAppServices();
  const router = useRouter();
  const { settings } = useSettings();
  const { state, reload, refreshing } = useAsyncResult(
    () => services.evaluateEtf(listingId, { analysis: { displayCurrency: settings.baseCurrency } }),
    [services, listingId, settings.baseCurrency],
  );

  const model = useMemo(
    () => (state.status === 'success' ? buildEtfViewModel(state.data) : null),
    [state],
  );
  const aiInput = useMemo(
    () =>
      state.status === 'success'
        ? buildInstrumentAiInput(state.data.evaluation, {
            displayName: model?.header.title ?? null,
          })
        : null,
    [state, model],
  );

  if (state.status === 'loading') {
    return (
      <Screen>
        <LoadingState label={strings.etf.loading} />
      </Screen>
    );
  }
  if (state.status === 'error' || model === null) {
    return (
      <Screen onRefresh={reload}>
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.status === 'error' && state.error.kind === 'VALIDATION' && (
          <SecondaryButton
            label={strings.etf.openAsStock}
            onPress={() => router.replace(stockHref(listingId))}
          />
        )}
      </Screen>
    );
  }

  const sectionsBefore = model.sections.filter((s) => s.id !== 'performance' && s.id !== 'risk');
  const sectionsAfter = model.sections.filter((s) => s.id === 'risk' || s.id === 'performance');

  return (
    <Screen onRefresh={reload} refreshing={refreshing} testID="etf-screen">
      <AnalysisHeader
        title={model.header.title}
        subtitle={model.header.subtitle}
        primaryHint={model.header.coverageText}
      />
      {refreshing && (
        <DataNotices
          notices={[
            {
              id: 'refreshing',
              tone: 'info',
              title: strings.states.refreshingTitle,
              message: strings.states.refreshing,
            },
          ]}
        />
      )}
      <DataNotices notices={model.notices} />
      <WatchlistToggle listingId={listingId} name={model.header.title} kind="etf" />
      <DecisionCard model={model.evaluation} />

      <Card title={strings.etf.limitationsTitle} testID="etf-limitations">
        <BulletList items={model.limitations} />
        <AppText variant="caption">{model.comparisonBasisText}</AppText>
      </Card>

      {sectionsBefore.map((s) => (
        <Section
          key={s.id}
          title={s.title}
          summary={s.summary}
          initiallyOpen={s.id === 'basics'}
          testID={`section-${s.id}`}>
          <MetricRows rows={s.rows} />
          <BulletList items={s.notes} />
        </Section>
      ))}
      <BreakdownSection
        title={strings.etf.countries}
        data={model.countries}
        testID="section-countries"
      />
      <BreakdownSection title={strings.etf.sectors} data={model.sectors} testID="section-sectors" />
      {sectionsAfter.map((s) => (
        <Section key={s.id} title={s.title} summary={s.summary} testID={`section-${s.id}`}>
          <MetricRows rows={s.rows} />
          <BulletList items={s.notes} />
        </Section>
      ))}

      <EvaluationDetails model={model.evaluation} />
      {aiInput !== null && aiInput.ok ? (
        <ExplanationSection input={aiInput.value} requiresConsent={false} />
      ) : (
        aiInput !== null && !aiInput.ok && <ErrorState error={aiInput.error} />
      )}

      <Section title={strings.etf.notApplicableTitle} testID="section-not-applicable">
        <BulletList items={model.notApplicable} />
      </Section>
      <Disclaimers items={[...model.disclaimers, ...model.evaluation.disclaimers]} />
    </Screen>
  );
}
