/**
 * Részvényelemzés képernyő (PHASE 12). Adat: `evaluateStock` use case (PHASE 06/07/10).
 * A logika a `buildStockViewModel`-ben (tiszta, tesztelt); itt csak elrendezés van.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

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
  DataNotices,
  ErrorState,
  LoadingState,
  MetricRows,
  Screen,
  SecondaryButton,
  Section,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useAsyncResult } from '@/presentation/hooks/use-async-result';
import { etfHref } from '@/presentation/navigation';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import {
  buildStockViewModel,
  type StockViewModel,
} from '@/presentation/view-models/stock-view-model';

function DcfSection({ dcf }: { readonly dcf: StockViewModel['dcf'] }) {
  const theme = useTheme();
  return (
    <Section
      title={strings.stock.dcfTitle}
      summary={dcf.available ? strings.stock.dcfAvailable : strings.stock.dcfUnavailable}
      testID="section-dcf">
      <AppText variant="caption" tone="warning">{`⚠ ${dcf.disclaimer}`}</AppText>
      <AppText variant="bodyStrong">{strings.stock.dcfInputs}</AppText>
      <MetricRows rows={dcf.inputs} />
      <AppText variant="bodyStrong">{strings.stock.dcfScenarios}</AppText>
      {dcf.scenarios.map((s) => (
        <View
          key={s.id}
          style={{
            gap: 2,
            paddingVertical: theme.spacing.xs,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}>
          <AppText variant="bodyStrong">{`${s.label}: ${s.valueText}`}</AppText>
          <AppText variant="caption">{`${s.mosText} · ${s.categoryText}`}</AppText>
          <AppText variant="caption" tone="textSecondary">
            {s.assumptionsText}
          </AppText>
          {s.reason !== null && (
            <AppText
              variant="caption"
              tone="textSecondary">{`${strings.common.reason}: ${s.reason}`}</AppText>
          )}
        </View>
      ))}
      <AppText variant="bodyStrong">{strings.stock.sensitivity}</AppText>
      {dcf.sensitivity.available ? (
        <View accessibilityLabel={strings.stock.sensitivityA11y} style={{ gap: 2 }}>
          {[
            { label: dcf.sensitivity.header[0] ?? '', cells: dcf.sensitivity.header.slice(1) },
            ...dcf.sensitivity.rows,
          ].map((row, index) => (
            <View
              key={`${row.label}-${index}`}
              style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
              <AppText
                variant="caption"
                style={{ width: 56, fontWeight: index === 0 ? '600' : '400' }}>
                {row.label}
              </AppText>
              {row.cells.map((cell, ci) => (
                <AppText
                  key={`${ci}-${cell}`}
                  variant="caption"
                  style={{
                    flex: 1,
                    textAlign: 'right',
                    fontVariant: ['tabular-nums'],
                    fontWeight: index === 0 ? '600' : '400',
                  }}>
                  {cell}
                </AppText>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <AppText
          variant="caption"
          tone="textSecondary">{`N/A – ${dcf.sensitivity.reason ?? ''}`}</AppText>
      )}
      {dcf.warnings.length > 0 && (
        <>
          <AppText variant="bodyStrong">{strings.common.warnings}</AppText>
          <BulletList items={dcf.warnings} />
        </>
      )}
      <AppText variant="bodyStrong">{strings.stock.conventions}</AppText>
      <BulletList items={dcf.conventions} />
    </Section>
  );
}

export function StockAnalysisScreen({ listingId }: { readonly listingId: string }) {
  const services = useAppServices();
  const router = useRouter();
  const { state, reload, refreshing } = useAsyncResult(
    () => services.evaluateStock(listingId),
    [services, listingId],
  );

  const model = useMemo(
    () => (state.status === 'success' ? buildStockViewModel(state.data) : null),
    [state],
  );
  const aiInput = useMemo(
    () =>
      state.status === 'success'
        ? buildInstrumentAiInput(state.data.evaluation, {
            valuation: state.data.valuation,
            displayName: state.data.fundamentals.overview.name,
          })
        : null,
    [state],
  );

  if (state.status === 'loading') {
    return (
      <Screen>
        <LoadingState label={strings.stock.loading} />
      </Screen>
    );
  }
  const error = state.status === 'error' ? state.error : (model?.blockingError ?? null);
  if (error !== null || model === null) {
    return (
      <Screen onRefresh={reload}>
        {error !== null && <ErrorState error={error} onRetry={reload} />}
        {error !== null && error.kind === 'VALIDATION' && (
          <SecondaryButton
            label={strings.stock.openAsEtf}
            onPress={() => router.replace(etfHref(listingId))}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen onRefresh={reload} refreshing={refreshing} testID="stock-screen">
      <AnalysisHeader
        title={model.header.title}
        subtitle={model.header.subtitle}
        primaryValue={model.header.priceText}
        primaryHint={model.header.priceHint}
        meta={model.header.meta}
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
      <WatchlistToggle listingId={listingId} name={model.header.title} kind="stock" />
      <DecisionCard model={model.evaluation} />

      {model.sections.map((s) => (
        <Section
          key={s.id}
          title={s.title}
          summary={s.summary}
          initiallyOpen={s.id === 'overview'}
          testID={`section-${s.id}`}>
          <MetricRows rows={s.rows} />
          <BulletList items={s.notes} />
        </Section>
      ))}

      <DcfSection dcf={model.dcf} />
      <EvaluationDetails model={model.evaluation} />

      {aiInput !== null && aiInput.ok ? (
        <ExplanationSection input={aiInput.value} requiresConsent={false} />
      ) : (
        aiInput !== null && !aiInput.ok && <ErrorState error={aiInput.error} />
      )}

      <Section
        title={strings.analysis.dataQualityTitle}
        summary={model.dataQuality.completenessText}
        testID="section-data-quality">
        <AppText variant="bodyStrong">{strings.analysis.gaps}</AppText>
        <BulletList items={model.dataQuality.gaps} />
        <AppText variant="bodyStrong">{strings.common.warnings}</AppText>
        <BulletList items={model.dataQuality.warnings} />
        <AppText variant="bodyStrong">{strings.analysis.sources}</AppText>
        <BulletList items={model.dataQuality.sources} />
      </Section>

      <Disclaimers items={[...model.disclaimers, ...model.evaluation.disclaimers]} />
    </Screen>
  );
}
