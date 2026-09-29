// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-image ships 132 MB of iOS-only .xcframework binaries under prebuilds/.
// Android and web never load them, but Metro's Windows fallback watcher walks
// and watches every one of them -- and AbstractWatcher rethrows any stat error
// instead of skipping the file, so a single transient `UNKNOWN: scandir` in
// there takes the whole dev server down mid-bundle (observed: exit code 7).
// Excluding the tree removes the crash site and shortens the crawl.
config.resolver.blockList = [
  ...config.resolver.blockList,
  /(?:^|[\\/])node_modules[\\/]expo-image[\\/]prebuilds[\\/]/,
  // npm stages a package in `node_modules/.<name>-<hash>` and renames it away
  // mid-install. The same watcher then throws ENOENT on the directory it just
  // walked and kills the dev server, so `npm install` with Metro running is
  // otherwise fatal.
  /(?:^|[\\/])node_modules[\\/](?:[^\\/]+[\\/])?\.[^\\/]+-[A-Za-z0-9]{8}(?:[\\/]|$)/,
];

// Metro defaults to one transform worker per core (12 here). Bundling the
// ~4,000-module Android graph with 12 workers pushed this machine past its
// commit limit and Node aborted with 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN)
// mid-bundle, over and over. 3 workers bundles in about the same wall-clock
// because the transform is I/O-bound here, and it leaves headroom for the
// emulator (~5.6 GB) and the Docker VM.
// ponytail: fixed at 3. Raise it if this ever runs on a box with real headroom.
config.maxWorkers = 3;

module.exports = config;
