export * from './src/cli';

import { main } from './src/cli';

if (require.main === module) {
  void main().then((exitCode) => {
    process.exit(exitCode);
  });
}
