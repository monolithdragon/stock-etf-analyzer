import { Link, Stack } from 'expo-router';

import { AppText, PrimaryButton, Screen } from '@/presentation/components';
import { strings } from '@/presentation/strings/hu';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: strings.notFound.title }} />
      <Screen>
        <AppText variant="heading">{strings.notFound.message}</AppText>
        <Link href="/" asChild>
          <PrimaryButton label={strings.notFound.backHome} />
        </Link>
      </Screen>
    </>
  );
}
