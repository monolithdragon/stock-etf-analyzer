// Jest-konfiguráció (D-032, D-041). Preset: jest-expo.
const fs = require('node:fs');

// Windows: ha a munkakönyvtár kisbetűs meghajtóval érkezik (pl. `c:\…` a VS Code-ból),
// a Jest ugyanazt a modult két útvonal-kulccsal (c:\ és C:\) kétszer töltheti be
// → két React-példány → "Invalid hook call". A kanonikus (valódi) útvonal ezt megszünteti.
const canonicalRoot = fs.realpathSync.native(__dirname);
if (
  process.cwd() !== canonicalRoot &&
  process.cwd().toLowerCase() === canonicalRoot.toLowerCase()
) {
  process.chdir(canonicalRoot);
}

module.exports = {
  preset: 'jest-expo',
  rootDir: canonicalRoot,
  // PHASE 13: a natív tároló- és hálózati modulok helyett tesztdublőrök. Az `expo-sqlite` helyén a
  // Node beépített SQLite-ja fut (valódi SQL), a kv-store és az expo-network memóriában.
  moduleNameMapper: {
    '^expo-sqlite$': '<rootDir>/src/testing/mocks/expo-sqlite.ts',
    '^expo-sqlite/kv-store$': '<rootDir>/src/testing/mocks/expo-sqlite-kv-store.ts',
    '^expo-network$': '<rootDir>/src/testing/mocks/expo-network.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/testing/jest-setup.ts'],
};
