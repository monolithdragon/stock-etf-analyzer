import { Link } from 'expo-router';

import { AppText, Card, InfoRow, PrimaryButton, Screen } from '@/presentation/components';
import { strings } from '@/presentation/strings/hu';

export default function HomeScreen() {
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        {strings.appName}
      </AppText>
      <AppText tone="textSecondary">{strings.home.tagline}</AppText>

      <Card title={strings.home.statusTitle}>
        <InfoRow label={strings.home.phaseLabel} value={strings.home.phaseValue} />
        <AppText tone="textSecondary">{strings.home.noDataYet}</AppText>
      </Card>

      <Link href="/about" asChild>
        <PrimaryButton label={strings.home.aboutButton} />
      </Link>

      <AppText variant="caption" tone="textSecondary">
        {strings.disclaimer}
      </AppText>
    </Screen>
  );
}
