import { publicEnvResult } from '@/config/env';
import { SettingsScreen } from '@/presentation/screens/settings-screen';

export default function SettingsRoute() {
  const { env, issues } = publicEnvResult;
  return (
    <SettingsScreen
      dataMode={env.dataMode}
      apiBaseUrl={env.apiBaseUrl}
      configIssues={issues.map((i) => `${i.variable}: ${i.message}`)}
    />
  );
}
