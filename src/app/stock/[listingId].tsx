import { Stack, useLocalSearchParams } from 'expo-router';

import { StockAnalysisScreen } from '@/presentation/screens/stock-analysis-screen';
import { strings } from '@/presentation/strings/hu';

export default function StockRoute() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const id = typeof listingId === 'string' ? listingId : '';
  return (
    <>
      <Stack.Screen options={{ title: id === '' ? strings.stock.title : id }} />
      <StockAnalysisScreen listingId={id} />
    </>
  );
}
