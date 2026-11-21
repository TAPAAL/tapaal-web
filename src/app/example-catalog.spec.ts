// @vitest-environment jsdom
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { parseSharedModel } from './core/shared-files';

it('catalog includes every unchanged native resource and records the real parser outcome', () => {
  const source = 'public/examples/';
  const families = [
    'P/T nets',
    'Timed-Arc Petri nets',
    'P/T net games',
    'Timed-Arc Petri net games',
    'Colored P/T nets',
    'Timed-Arc Colored Petri nets',
    'Timed-Arc Stochastic Petri nets',
    'Timed-Arc Stochastic Colored Petri nets',
  ];
  const catalog = readdirSync(source)
    .filter((n) => n.endsWith('.tapn'))
    .map((filename) => {
      const bytes = readFileSync(source + filename),
        text = bytes.toString();
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      const feature = xml.querySelector('feature');
      const flag = (name: string) => feature?.getAttribute(name) === 'true';
      const timed = feature ? flag('isTimed') : true,
        colored = flag('isColored'),
        game = flag('isGame'),
        stochastic = flag('isStochastic');
      const family =
        families[
          stochastic
            ? colored
              ? 7
              : 6
            : colored
              ? timed
                ? 5
                : 4
              : game
                ? timed
                  ? 3
                  : 2
                : timed
                  ? 1
                  : 0
        ];
      let reason = '',
        warnings: string[] = [];
      try {
        warnings = parseSharedModel(text, filename).warnings;
      } catch (error) {
        reason = (error as Error).message;
      }
      const stats = {
        places: xml.querySelectorAll('net > place').length,
        transitions: xml.querySelectorAll('net > transition').length,
        arcs: xml.querySelectorAll(
          'net > arc, net > inputArc, net > outputArc, net > inhibitorArc, net > transportArc',
        ).length,
        components: xml.querySelectorAll('net').length,
      };
      const entry = {
        filename,
        url: 'examples/' + encodeURIComponent(filename),
        label: filename.replace(/\.tapn$/, ''),
        family,
        timed,
        colored,
        game,
        stochastic,
        constants: xml.querySelectorAll('constant').length,
        sharedPlaces: xml.querySelectorAll('shared-place').length,
        sharedTransitions: xml.querySelectorAll('shared-transition').length,
        stats,
        reason,
        warnings,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      return entry;
    })
    .sort(
      (a, b) =>
        families.indexOf(a.family) - families.indexOf(b.family) ||
        (a.filename === 'intro-example.tapn'
          ? -1
          : b.filename === 'intro-example.tapn'
            ? 1
            : a.filename === 'game-harddisk.tapn'
              ? 1
              : b.filename === 'game-harddisk.tapn'
                ? -1
                : a.filename < b.filename
                  ? -1
                  : a.filename > b.filename
                    ? 1
                    : 0),
    );
  if (process.env['UPDATE_EXAMPLES'])
    writeFileSync('src/app/example-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
  expect(JSON.parse(readFileSync('src/app/example-catalog.json', 'utf8'))).toEqual(catalog);
  expect(
    readdirSync('public/examples')
      .filter((n) => n.endsWith('.tapn'))
      .sort(),
  ).toEqual(catalog.map((e) => e.url.split('/')[1]).sort());
});
