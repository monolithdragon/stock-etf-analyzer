import { publicEnvResult } from '@/config/env';
import { HomeScreen } from '@/presentation/screens/home-screen';

export default function HomeRoute() {
  const { env } = publicEnvResult;
  return <HomeScreen dataMode={env.dataMode} proxyConfigured={env.apiBaseUrl !== null} />;
}
