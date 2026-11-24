import { Stack, useLocalSearchParams } from 'expo-router';

import { EtfAnalysisScreen } from '@/presentation/screens/etf-analysis-screen';
import { strings } from '@/presentation/strings/hu';

export default function EtfRoute() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const id = typeof listingId === 'string' ? listingId : '';
  return (
    <>
      <Stack.Screen options={{ title: id === '' ? strings.etf.title : id }} />
      <EtfAnalysisScreen listingId={id} />
    </>
  );
}
