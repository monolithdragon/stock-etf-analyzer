import { createContext, useContext, type ReactNode } from 'react';

import type { AppServices } from '@/application';

/**
 * A use case-ek eljuttatása a képernyőkhöz. A képernyő így nem tudja (és nem is kell
 * tudnia), hogy mock vagy élő adatforrás, memóriabeli vagy SQLite tároló van mögötte.
 */
const AppServicesContext = createContext<AppServices | null>(null);

export function AppServicesProvider({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === null) {
    // Programozási hiba (rossz bekötés), nem várt üzleti hiba – ezért kivétel, nem Result.
    throw new Error('useAppServices: hiányzó <AppServicesProvider> a komponensfa tetején.');
  }
  return services;
}
