// Extends app.json (which Expo passes in as `config`); everything static lives there.
//
// Android push needs Firebase's google-services.json (docs/DEPLOYMENT.md,
// "Push notifications setup"). The repo is public, so the file is gitignored:
// EAS gets it as a file-type env var (GOOGLE_SERVICES_JSON holds its path), a
// local build reads it from this folder. With neither, the build still works,
// just without push.
const fs = require('fs');
const path = require('path');

module.exports = ({ config, projectRoot }) => {
  const file =
    process.env.GOOGLE_SERVICES_JSON ||
    (fs.existsSync(path.join(projectRoot, 'google-services.json')) ? './google-services.json' : null);
  if (file) config.android = { ...config.android, googleServicesFile: file };
  return config;
};
