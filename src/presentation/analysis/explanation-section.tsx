/**
 * „Magyarázat” szakasz (PHASE 11 → 12 kapcsolódási pont, D-078).
 *
 * - Alapból a szabályalapú (offline, ingyenes) magyarázat jelenik meg „Szabályalapú
 *   összefoglaló” címkével.
 * - LLM-hívás CSAK felhasználói gombnyomásra, és csak ha a Beállításokban engedélyezett.
 *   Portfóliónál előtte kifejezett beleegyezés kell (adat megy külső szolgáltatóhoz).
 * - LLM-válasz „AI-értelmezés” címkével, modellel és időbélyeggel; hiba esetén érthető üzenet,
 *   a szabályalapú szöveg marad.
 * - A confidence NEM valószínűség; a `basedOn` hivatkozások láthatók.
 */
import { useState } from 'react';
import { View } from 'react-native';

import type { ExplainAnalysisRequest, ExplanationOutcome } from '@/application';
import { AppErrors, type AppError } from '@/domain';
import {
  AppText,
  ErrorState,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
  Section,
  StatusBadge,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { formatAppError, formatDateTime } from '@/presentation/format';
import { useAsyncResult } from '@/presentation/hooks/use-async-result';
import { useSettings } from '@/presentation/state/settings-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

type ExplanationDisplay = ExplanationOutcome['display'];
type ExplanationContent = ExplanationDisplay['content'];
type Statement = ExplanationContent['summary'];

const LIST_SECTIONS = [
  ['positives', 'Erősségek'],
  ['negatives', 'Gyengeségek'],
  ['keyRisks', 'Fő kockázatok'],
  ['valuationExplanation', 'Értékelés magyarázata'],
  ['dcfAssumptions', 'DCF-feltevések'],
  ['dataGaps', 'Adathiányok'],
  ['reviewTriggers', 'Felülvizsgálati pontok'],
  ['thesisInvalidators', 'A tézist érvénytelenítő események'],
] as const;

function StatementView({ statement }: { readonly statement: Statement }) {
  const theme = useTheme();
  const insufficient = statement.support === 'insufficient_data';
  return (
    <View style={{ gap: 2 }}>
      <AppText
        tone={insufficient ? 'textSecondary' : 'text'}
        style={insufficient ? { fontStyle: 'italic' } : undefined}>
        {insufficient ? `${strings.explanation.insufficient} – ${statement.text}` : statement.text}
      </AppText>
      {statement.basedOn.length > 0 && (
        <AppText variant="caption" tone="textSecondary" style={{ marginBottom: theme.spacing.xs }}>
          {`${strings.explanation.basedOn}: ${statement.basedOn.join(', ')}`}
        </AppText>
      )}
    </View>
  );
}

function ExplanationBody({ display }: { readonly display: ExplanationDisplay }) {
  const theme = useTheme();
  const isAi = display.meta.provenanceKind === 'ai_interpretation';
  const c = display.content;
  return (
    <View style={{ gap: theme.spacing.md }} testID="explanation-body">
      <StatusBadge
        tone={isAi ? 'warning' : 'info'}
        label={isAi ? strings.explanation.aiLabel : strings.explanation.templateLabel}
      />
      <AppText variant="caption" tone="textSecondary">
        {isAi
          ? `${strings.explanation.aiNote} ${display.meta.model ?? ''} · ${formatDateTime(display.meta.generatedAt)}`
          : strings.explanation.templateNote}
      </AppText>
      <StatementView statement={c.summary} />
      {LIST_SECTIONS.map(([key, title]) =>
        c[key].length === 0 ? null : (
          <View key={key} style={{ gap: theme.spacing.xs }}>
            <AppText variant="bodyStrong">{title}</AppText>
            {c[key].map((statement, index) => (
              <StatementView key={`${key}-${index}`} statement={statement} />
            ))}
          </View>
        ),
      )}
      <AppText variant="caption" tone="textSecondary">
        {`${strings.explanation.confidence}: ${c.confidence.explanation}`}
      </AppText>
    </View>
  );
}

type LlmState =
  | { readonly status: 'idle' }
  | { readonly status: 'consent' }
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly outcome: ExplanationOutcome }
  | { readonly status: 'error'; readonly error: AppError };

export interface ExplanationSectionProps {
  /** Az alkalmazási réteg építi (`buildInstrumentAiInput` / `buildPortfolioAiInput`). */
  readonly input: ExplainAnalysisRequest['input'];
  readonly requiresConsent: boolean;
}

export function ExplanationSection({ input, requiresConsent }: ExplanationSectionProps) {
  const theme = useTheme();
  const services = useAppServices();
  const { settings } = useSettings();
  const [llm, setLlm] = useState<LlmState>({ status: 'idle' });

  const template = useAsyncResult(
    () => services.explainAnalysis({ input, mode: 'template' }),
    [services, input],
  );

  const requestLlm = (withConsent: boolean) => {
    setLlm({ status: 'loading' });
    services
      .explainAnalysis({
        input,
        mode: 'llm',
        consent: withConsent ? { shareWithAiProvider: true } : null,
      })
      .then((result) => {
        setLlm(
          result.ok
            ? { status: 'done', outcome: result.value }
            : { status: 'error', error: result.error },
        );
      })
      .catch((cause: unknown) =>
        setLlm({
          status: 'error',
          error: AppErrors.calculationInvalid(
            cause instanceof Error ? cause.message : String(cause),
          ),
        }),
      );
  };

  const display =
    llm.status === 'done'
      ? llm.outcome.display
      : template.state.status === 'success'
        ? template.state.data.display
        : null;
  const llmError =
    llm.status === 'error'
      ? llm.error
      : llm.status === 'done' && llm.outcome.llm.status === 'failed'
        ? llm.outcome.llm.error
        : null;

  return (
    <Section
      title={strings.explanation.title}
      summary={strings.explanation.summary}
      testID="section-explanation">
      {template.state.status === 'loading' && <LoadingState />}
      {template.state.status === 'error' && (
        <ErrorState error={template.state.error} onRetry={template.reload} />
      )}
      {llmError !== null && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: theme.spacing.xs,
            padding: theme.spacing.md,
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: theme.radius.md,
          }}>
          <AppText
            variant="bodyStrong"
            tone="warning">{`⚠ ${formatAppError(llmError).title}`}</AppText>
          <AppText variant="caption">{strings.explanation.llmFailedKeepTemplate}</AppText>
        </View>
      )}
      {display !== null && <ExplanationBody display={display} />}

      {settings.llmEnabled ? (
        <>
          {llm.status === 'consent' && (
            <View style={{ gap: theme.spacing.sm }} testID="ai-consent">
              <AppText variant="bodyStrong">{strings.explanation.consentTitle}</AppText>
              <AppText variant="caption">{strings.explanation.consentText}</AppText>
              <PrimaryButton
                label={strings.explanation.consentAccept}
                onPress={() => requestLlm(true)}
              />
              <SecondaryButton
                label={strings.explanation.consentCancel}
                onPress={() => setLlm({ status: 'idle' })}
              />
            </View>
          )}
          {llm.status === 'loading' && <LoadingState label={strings.explanation.llmLoading} />}
          {(llm.status === 'idle' || llm.status === 'done' || llm.status === 'error') && (
            <SecondaryButton
              label={strings.explanation.requestLlm}
              accessibilityHint={strings.explanation.requestLlmHint}
              onPress={() => (requiresConsent ? setLlm({ status: 'consent' }) : requestLlm(false))}
            />
          )}
        </>
      ) : (
        <AppText variant="caption" tone="textSecondary">
          {strings.explanation.llmDisabledHint}
        </AppText>
      )}
    </Section>
  );
}
