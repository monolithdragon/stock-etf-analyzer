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
};
