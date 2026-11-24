/**
 * Közös értékelés-megjelenítés részvényhez és ETF-hez (PHASE 12).
 * A címke és a pont a döntési engine kimenete; itt csak megjelenítés történik.
 */
import { View } from 'react-native';

import { AppText, Card, InfoRow, Section, StatusBadge } from '@/presentation/components';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import type { EvaluationViewModel } from '@/presentation/view-models/evaluation-view-model';

export function BulletList({
  items,
  testID,
}: {
  readonly items: readonly string[];
  readonly testID?: string;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: theme.spacing.xs }} testID={testID}>
      {items.map((item, index) => (
        <AppText key={`${index}-${item.slice(0, 24)}`} variant="caption">{`• ${item}`}</AppText>
      ))}
    </View>
  );
}

/** Döntés + összpontszám + confidence egy kártyán, mindig a nyilatkozattal. */
export function DecisionCard({ model }: { readonly model: EvaluationViewModel }) {
  const theme = useTheme();
  const { decision, score, confidence } = model;
  return (
    <Card
      title={strings.analysis.decisionTitle}
      subtitle={strings.analysis.decisionSubtitle}
      testID="decision-card">
      <View style={{ gap: theme.spacing.sm }}>
        <StatusBadge
          label={decision.labelText}
          tone={decision.tone}
          icon={decision.rated ? undefined : '○'}
        />
        <AppText>{decision.description}</AppText>
        {decision.caps.length > 0 && (
          <AppText variant="caption" tone="warning">
            {`${strings.analysis.capsApplied} ${decision.caps.join(' ')}`}
          </AppText>
        )}
      </View>
      <InfoRow label={strings.analysis.totalScore} value={score.totalText} />
      <AppText variant="caption" tone="textSecondary">
        {`${score.statusText} · ${score.coverageText}`}
      </AppText>
      <InfoRow
        label={strings.analysis.confidence}
        value={`${confidence.levelText} (${confidence.scoreText})`}
      />
      <AppText variant="caption" tone="textSecondary">
        {confidence.meaning}
      </AppText>
      <AppText variant="caption" tone="textSecondary" testID="decision-disclaimer">
        {model.disclaimers[1] ?? model.disclaimers[0]}
      </AppText>
    </Card>
  );
}

/** Részletes score-kategóriák, döntési okok, confidence-okok és tézis. */
export function EvaluationDetails({ model }: { readonly model: EvaluationViewModel }) {
  const theme = useTheme();
  return (
    <Section
      title={strings.analysis.scoreTitle}
      summary={model.score.totalText}
      testID="section-score">
      <AppText variant="bodyStrong">{strings.analysis.drivers}</AppText>
      <BulletList items={model.decision.drivers} />

      <AppText variant="bodyStrong">{strings.analysis.categories}</AppText>
      {model.score.categories.map((category) => (
        <View
          key={category.id}
          style={{
            gap: theme.spacing.xs,
            paddingVertical: theme.spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}>
          <InfoRow label={category.label} value={category.scoreText} />
          <AppText variant="caption" tone="textSecondary">
            {`${category.statusText} · ${category.weightText} · ${category.coverageText}`}
          </AppText>
          <BulletList items={category.rationale} />
          {category.missing.length > 0 && (
            <AppText variant="caption" tone="textSecondary">
              {`${strings.analysis.missingPrefix} ${category.missing.join(' | ')}`}
            </AppText>
          )}
        </View>
      ))}

      <AppText variant="bodyStrong">{strings.analysis.confidenceReasons}</AppText>
      <BulletList items={model.confidence.reasons} />

      <AppText variant="bodyStrong">{`${strings.analysis.thesis}: ${model.thesis.stanceText}`}</AppText>
      <AppText variant="caption">{model.thesis.note}</AppText>
      {model.thesis.risks.length > 0 && (
        <>
          <AppText variant="bodyStrong">{strings.analysis.risks}</AppText>
          <BulletList items={model.thesis.risks.map((r) => r.text)} />
        </>
      )}
      {model.thesis.invalidation.length > 0 && (
        <>
          <AppText variant="bodyStrong">{strings.analysis.invalidation}</AppText>
          <BulletList items={model.thesis.invalidation.map((r) => r.text)} />
        </>
      )}

      <AppText variant="bodyStrong">{strings.analysis.method}</AppText>
      <AppText variant="caption" tone="textSecondary">
        {model.score.formula}
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {model.score.missingDataPolicy}
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {`${strings.analysis.config}: ${model.decision.configText}`}
      </AppText>
      <BulletList items={model.warnings} />
    </Section>
  );
}

export function Disclaimers({ items }: { readonly items: readonly string[] }) {
  const theme = useTheme();
  const unique = [...new Set([...items, strings.disclaimer])];
  return (
    <View style={{ gap: theme.spacing.xs }} testID="disclaimers">
      {unique.map((text) => (
        <AppText key={text} variant="caption" tone="textSecondary">
          {text}
        </AppText>
      ))}
    </View>
  );
}
