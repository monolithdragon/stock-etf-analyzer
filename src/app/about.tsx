import Constants from 'expo-constants';

import { publicEnvResult } from '@/config/env';
import { AppText, Card, InfoRow, Screen } from '@/presentation/components';
import { strings } from '@/presentation/strings/hu';

export default function AboutScreen() {
  const { env, issues } = publicEnvResult;
  const appVersion = Constants.expoConfig?.version ?? strings.common.unknown;
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? strings.common.unknown;

  return (
    <Screen>
      <Card title={strings.about.versionTitle}>
        <InfoRow label={strings.about.appVersion} value={appVersion} />
        <InfoRow label={strings.about.expoSdk} value={sdkVersion} />
      </Card>

      <Card title={strings.about.configTitle}>
        <InfoRow
          label={strings.about.dataMode}
          value={env.dataMode === 'live' ? strings.about.dataModeLive : strings.about.dataModeMock}
        />
        <InfoRow label={strings.about.apiBaseUrl} value={env.apiBaseUrl ?? strings.common.notSet} />
        <AppText variant="caption" tone="textSecondary">
          {strings.about.configHint}
        </AppText>
      </Card>

      {issues.length > 0 && (
        <Card title={strings.about.configIssuesTitle}>
          {issues.map((issue) => (
            <AppText key={`${issue.variable}:${issue.message}`} tone="warning">
              {`${issue.variable}: ${issue.message}`}
            </AppText>
          ))}
        </Card>
      )}

      <Card title={strings.about.principlesTitle}>
        {strings.about.principles.map((principle) => (
          <AppText key={principle}>{`• ${principle}`}</AppText>
        ))}
      </Card>

      <AppText variant="caption" tone="textSecondary">
        {strings.disclaimer}
      </AppText>
    </Screen>
  );
}
