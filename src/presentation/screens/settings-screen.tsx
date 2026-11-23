/**
 * Beállítások (PHASE 12): bázispénznem, téma, AI-magyarázat, adatforrás-konfiguráció.
 *
 * Az adatforrás (mock/live, proxy URL) build-időben dől el (`EXPO_PUBLIC_*`), titkot nem
 * tartalmaz; itt csak megjelenik, és leírjuk, hogyan változtatható. Szolgáltatói API-kulcs
 * SOHA nem a kliensben van (CLAUDE.md, Biztonság) – azt a proxy `.env.local`-ja tartja.
 */
import { Link } from 'expo-router';
import { Switch, View } from 'react-native';

import {
  AppText,
  Card,
  ChoiceGroup,
  InfoRow,
  Screen,
  SecondaryButton,
} from '@/presentation/components';
import {
  BASE_CURRENCIES,
  useSettings,
  type BaseCurrency,
} from '@/presentation/state/settings-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme, type ThemePreference } from '@/presentation/theme';

export interface SettingsScreenProps {
  readonly dataMode: 'mock' | 'live';
  readonly apiBaseUrl: string | null;
  readonly configIssues: readonly string[];
}

export function SettingsScreen({ dataMode, apiBaseUrl, configIssues }: SettingsScreenProps) {
  const theme = useTheme();
  const { settings, updateSettings } = useSettings();

  return (
    <Screen testID="settings-screen">
      <Card title={strings.settings.baseCurrencyTitle} subtitle={strings.settings.baseCurrencyHint}>
        <ChoiceGroup<BaseCurrency>
          label={strings.settings.baseCurrencyTitle}
          options={BASE_CURRENCIES.map((c) => ({ value: c, label: c }))}
          value={settings.baseCurrency}
          onChange={(baseCurrency) => updateSettings({ baseCurrency })}
        />
      </Card>

      <Card title={strings.settings.themeTitle}>
        <ChoiceGroup<ThemePreference>
          label={strings.settings.themeTitle}
          options={[
            { value: 'system', label: strings.settings.themeSystem },
            { value: 'light', label: strings.settings.themeLight },
            { value: 'dark', label: strings.settings.themeDark },
          ]}
          value={settings.themePreference}
          onChange={(themePreference) => updateSettings({ themePreference })}
        />
      </Card>

      <Card title={strings.settings.aiTitle} subtitle={strings.settings.aiHint}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing.md,
            minHeight: theme.minTouchTarget,
          }}>
          <AppText style={{ flexShrink: 1 }}>{strings.settings.aiToggle}</AppText>
          <Switch
            testID="llm-switch"
            accessibilityLabel={strings.settings.aiToggle}
            value={settings.llmEnabled}
            onValueChange={(llmEnabled) => updateSettings({ llmEnabled })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
        <AppText variant="caption" tone="textSecondary">
          {settings.llmEnabled ? strings.settings.aiOnNote : strings.settings.aiOffNote}
        </AppText>
      </Card>

      <Card title={strings.settings.dataTitle} subtitle={strings.settings.dataHint}>
        <InfoRow
          label={strings.about.dataMode}
          value={dataMode === 'live' ? strings.about.dataModeLive : strings.about.dataModeMock}
        />
        <InfoRow label={strings.about.apiBaseUrl} value={apiBaseUrl ?? strings.common.notSet} />
        {configIssues.map((issue) => (
          <AppText key={issue} tone="warning">{`⚠ ${issue}`}</AppText>
        ))}
        <AppText variant="caption" tone="textSecondary">
          {strings.settings.dataHowTo}
        </AppText>
      </Card>

      <AppText variant="caption" tone="textSecondary">
        {strings.settings.memoryNote}
      </AppText>
      <Link href="/about" asChild>
        <SecondaryButton label={strings.home.aboutButton} />
      </Link>
    </Screen>
  );
}
