import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const web = resolve(import.meta.dirname, '../..');
const lib = process.env.TAPAAL_LIB ?? '/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib';
const out = mkdtempSync(join(tmpdir(), 'tapaal-arc-labels-'));
try {
  execFileSync(
    'javac',
    [
      '-J-Xmx128m',
      '-cp',
      `${lib}/*`,
      '-d',
      out,
      join(import.meta.dirname, 'ArcLabelReference.java'),
    ],
    { stdio: 'inherit' },
  );
  execFileSync(
    'xvfb-run',
    [
      '-a',
      'java',
      '-Xmx128m',
      '-cp',
      `${out}:${lib}/*`,
      'ArcLabelReference',
      ...['untimedGame', 'game-harddisk'].map((name) =>
        join(web, 'public/examples', name + '.tapn'),
      ),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
