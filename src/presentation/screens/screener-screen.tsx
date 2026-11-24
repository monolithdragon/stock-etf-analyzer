/**
 * Screener (PHASE 14). Feltételek összeállítása (kiinduló szűrők vagy kézi), érvénytelen
 * szűrő kezelése (az application `validateScreenerQuery` üzenetei a feltétel mellett),
 * futtatás a lokális univerzumon (`runScreen`), találatok feltételenkénti bizonyítékkal.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  SCREENER_CATEGORY_LABEL,
  SCREENER_FIELDS,
  SCREENER_PRESETS,
  screenerField,
  validateScreenerQuery,
  type ScreenerCategory,
  type ScreenerCriterion,
  type ScreenerOperator,
  type ScreenerResult,
  type ScreenerIssue,
} from '@/application';
import type { AppError } from '@/domain';
import {
  AppText,
  Card,
  ChoiceGroup,
  DetailList,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  MetricRows,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Section,
  TextField,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useSettings } from '@/presentation/state/settings-context';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import {
  buildScreenerViewModel,
  formatThreshold,
  inputUnitHint,
  parseThresholdInput,
  type ScreenerRowModel,
} from '@/presentation/view-models/insights-view-model';

type Universe = 'stock' | 'etf';

type RunState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: AppError }
  | { readonly status: 'success'; readonly data: ScreenerResult };

const OPERATOR_TEXT = { gte: '≥', lte: '≤' } as const;

function criterionText(c: ScreenerCriterion): string {
  const field = screenerField(c.fieldId);
  if (field === undefined) return c.fieldId;
  return `${field.label} ${OPERATOR_TEXT[c.operator]} ${formatThreshold(c.value, field.unit, c.currency)}`;
}

function ResultRows({ rows }: { readonly rows: readonly ScreenerRowModel[] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      {rows.map((row) => (
        <View key={row.key} testID={`screen-row-${row.key}`} style={{ gap: theme.spacing.xs }}>
          <ListItem title={row.title} subtitle={row.subtitle} />
          <MetricRows rows={row.evidence} />
          {row.staleNote !== null && (
            <AppText variant="caption" tone="warning">{`⚠ ${row.staleNote}`}</AppText>
          )}
        </View>
      ))}
    </View>
  );
}

export function ScreenerScreen() {
  const theme = useTheme();
  const services = useAppServices();
  const { settings } = useSettings();
  const watchlist = useWatchlist();
  const [universe, setUniverse] = useState<Universe>('stock');
  const [criteria, setCriteria] = useState<readonly ScreenerCriterion[]>([]);
  const [category, setCategory] = useState<ScreenerCategory>('valuation');
  const [fieldId, setFieldId] = useState<string>('pe');
  const [operator, setOperator] = useState<ScreenerOperator>('lte');
  const [threshold, setThreshold] = useState('');
  const [currency, setCurrency] = useState<string>(settings.baseCurrency);
  const [issues, setIssues] = useState<readonly ScreenerIssue[]>([]);
  const [run, setRun] = useState<RunState>({ status: 'idle' });

  const categories = useMemo(
    () =>
      (Object.keys(SCREENER_CATEGORY_LABEL) as ScreenerCategory[]).filter((c) =>
        SCREENER_FIELDS.some((f) => f.category === c && f.appliesTo === universe),
      ),
    [universe],
  );
  const fields = SCREENER_FIELDS.filter((f) => f.category === category && f.appliesTo === universe);
  const field = screenerField(fieldId);

  const changeUniverse = (next: Universe) => {
    setUniverse(next);
    setCriteria([]);
    setIssues([]);
    setRun({ status: 'idle' });
    const firstCategory = SCREENER_FIELDS.find((f) => f.appliesTo === next)!;
    setCategory(firstCategory.category);
    setFieldId(firstCategory.id);
  };

  const changeCategory = (next: ScreenerCategory) => {
    setCategory(next);
    const first = SCREENER_FIELDS.find((f) => f.category === next && f.appliesTo === universe);
    if (first !== undefined) setFieldId(first.id);
  };

  const add = () => {
    if (field === undefined) return;
    const criterion: ScreenerCriterion = {
      fieldId,
      operator,
      value: parseThresholdInput(threshold, field.unit),
      ...(field.unit === 'money' ? { currency: currency.trim().toUpperCase() } : {}),
    };
    const next = [...criteria, criterion];
    const found = validateScreenerQuery({ universe, criteria: next }).filter(
      (i) => i.index === next.length - 1,
    );
    setIssues(found);
    if (found.length === 0) {
      setCriteria(next);
      setThreshold('');
    }
  };

  const start = () => {
    const query = { universe, criteria };
    const found = validateScreenerQuery(query);
    setIssues(found);
    if (found.length > 0) return;
    setRun({ status: 'loading' });
    services
      .runScreen(query, { displayCurrency: settings.baseCurrency })
      .then((result) =>
        setRun(
          result.ok
            ? { status: 'success', data: result.value }
            : { status: 'error', error: result.error },
        ),
      )
      .catch(() => undefined);
  };

  const model = run.status === 'success' ? buildScreenerViewModel(run.data) : null;
  const universeEmpty = watchlist.items.length === 0;

  return (
    <Screen testID="screener-screen">
      <Card title={strings.screener.title} subtitle={strings.screener.subtitle}>
        <AppText variant="caption" tone="textSecondary">
          {strings.screener.universe}
        </AppText>
        <ChoiceGroup
          label={strings.screener.universe}
          options={[
            { value: 'stock', label: strings.screener.stocks },
            { value: 'etf', label: strings.screener.etfs },
          ]}
          value={universe}
          onChange={changeUniverse}
        />
      </Card>
      {universeEmpty && (
        <EmptyState
          title={strings.screener.emptyUniverseTitle}
          message={strings.screener.emptyUniverse}
        />
      )}
      <Card title={strings.screener.presets}>
        <View style={{ gap: theme.spacing.xs }}>
          {SCREENER_PRESETS.filter((p) => p.query.universe === universe).map((preset) => (
            <SecondaryButton
              key={preset.id}
              compact
              label={preset.label}
              onPress={() => {
                setCriteria(preset.query.criteria);
                setIssues([]);
              }}
            />
          ))}
        </View>
      </Card>
      <Card title={strings.screener.criteria} testID="screener-criteria">
        {criteria.length === 0 && (
          <AppText tone="textSecondary">{strings.screener.noCriteria}</AppText>
        )}
        {criteria.map((c, index) => (
          <View
            key={`${c.fieldId}-${c.operator}-${index}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <AppText style={{ flex: 1 }}>{criterionText(c)}</AppText>
            <SecondaryButton
              compact
              label="✕"
              accessibilityLabel={`${strings.screener.removeCriterion}: ${criterionText(c)}`}
              onPress={() => setCriteria(criteria.filter((_, i) => i !== index))}
            />
          </View>
        ))}
        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <ChoiceGroup
            label={strings.screener.category}
            options={categories.map((c) => ({ value: c, label: SCREENER_CATEGORY_LABEL[c] }))}
            value={category}
            onChange={changeCategory}
          />
          <ChoiceGroup
            label={strings.screener.field}
            options={fields.map((f) => ({ value: f.id, label: f.label }))}
            value={fieldId}
            onChange={setFieldId}
          />
          <ChoiceGroup
            label={strings.screener.operator}
            options={[
              { value: 'gte', label: '≥' },
              { value: 'lte', label: '≤' },
            ]}
            value={operator}
            onChange={setOperator}
          />
          <TextField
            label={`${strings.screener.threshold} – ${field === undefined ? '' : inputUnitHint(field.unit)}`}
            value={threshold}
            onChangeText={setThreshold}
            keyboardType="decimal-pad"
            error={issues.length > 0 ? issues.map((i) => i.message).join(' ') : null}
          />
          {field?.unit === 'money' && (
            <TextField
              label={strings.screener.currency}
              value={currency}
              onChangeText={setCurrency}
              autoCapitalize="characters"
              maxLength={3}
            />
          )}
          <SecondaryButton label={strings.screener.addCriterion} onPress={add} />
        </View>
      </Card>
      <PrimaryButton
        label={strings.screener.run}
        accessibilityHint={strings.screener.runHint}
        disabled={run.status === 'loading'}
        onPress={start}
      />
      {run.status === 'loading' && <LoadingState label={strings.screener.loading} />}
      {run.status === 'error' && <ErrorState error={run.error} onRetry={start} />}
      {model !== null && (
        <>
          <Card title={strings.screener.matches} subtitle={model.summary} testID="screener-results">
            {model.matches.length === 0 ? (
              <AppText tone="textSecondary">{strings.screener.noMatches}</AppText>
            ) : (
              <ResultRows rows={model.matches} />
            )}
          </Card>
          {model.notEvaluable.length > 0 && (
            <Section
              title={strings.screener.notEvaluable}
              summary={String(model.notEvaluable.length)}
              initiallyOpen>
              <ResultRows rows={model.notEvaluable} />
            </Section>
          )}
          {model.failed.length > 0 && (
            <Section title={strings.screener.failed} summary={String(model.failed.length)}>
              <ResultRows rows={model.failed} />
            </Section>
          )}
          {model.skipped.length > 0 && (
            <Section title={strings.screener.skipped} summary={String(model.skipped.length)}>
              <DetailList lines={model.skipped.map((s) => ({ label: s.title, value: s.reason }))} />
            </Section>
          )}
          <AppText variant="caption" tone="textSecondary">
            {model.disclaimer}
          </AppText>
        </>
      )}
    </Screen>
  );
}
