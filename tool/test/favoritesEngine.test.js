// Pairing guardrails for the favorites engine (shared with the site).
// Run: cd tool && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../site/src/lib/favoritesEngine.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `t/p${String(i).padStart(3, '0')}`);
const key = (a, b) => [a, b].sort().join(' ');

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0), x / 4294967296);
}

// Play a whole game, asserting at every pick that a pair only repeats when
// nothing new is left: in the cull, every surviving photo has met every
// other; in the final, the leading photo has played everyone else as often.
function play(n, count, lives, seed) {
  const rand = rng(seed);
  const quality = new Map(ids(n).map((id) => [id, rand()]));
  let s = E.newSession(ids(n), { count, lives, seed: `test-${seed}` });
  for (let pick = 0; pick < 20000; pick++) {
    const d = E.derive(s);
    const pair = E.nextPair(s, d);
    if (!pair) return s;
    const [a, b] = pair;
    assert.notEqual(a, b);
    if (d.stats.get(a).opp.has(b)) {
      if (!d.finalists) {
        for (const x of d.alive) {
          for (const y of d.alive) {
            if (x !== y) assert.ok(d.stats.get(x).opp.has(y), `cull rematch ${key(a, b)} at pick ${pick} while ${key(x, y)} unmet`);
          }
        }
      } else {
        const times = (id) => d.played.get(a).get(id) || 0;
        for (const c of d.finalists) if (c !== a) assert.ok(times(b) <= times(c), `final rematch ${key(a, b)} before ${key(a, c)}`);
      }
    }
    const r = rand();
    let result = r < 0.1 ? 'both' : r < 0.15 ? 'neither' : quality.get(a) + (rand() - 0.5) * 0.3 > quality.get(b) ? 'a' : 'b';
    if (E.checkDecision(s, { a, b, result }, d)) result = 'a';
    s = E.decide(s, { a, b, result });
  }
  assert.fail('game never finished');
}

test('no early rematches across sizes, counts and lives', () => {
  let seed = 1;
  for (const n of [12, 15, 25, 40, 80, 200]) {
    for (const count of [1, 5, 10, 20]) {
      for (const lives of [1, 2, 3]) {
        if (count < n) for (let i = 0; i < 3; i++) play(n, count, lives, seed++);
      }
    }
  }
});

test('a photo that has met everyone does not force a rematch while others have not', () => {
  // 14 photos, top 1 → 11 finalists, so this is still the cull. Everyone has
  // met everyone except p001–p002, and p000 has played the fewest games — the
  // old pairing let it lead and rematch someone it had already faced.
  const all = ids(14);
  const both = (a, b) => ({ a, b, result: 'both' });
  const history = [];
  for (let i = 0; i < 14; i++) for (let j = i + 1; j < 14; j++) if (!(i === 1 && j === 2)) history.push(both(all[i], all[j]));
  for (const [i, j] of [[1, 3], [2, 4], [1, 5], [2, 6], [7, 8], [9, 10], [11, 12], [13, 7]]) history.push(both(all[i], all[j]));
  const s = { ...E.newSession(all, { count: 1, lives: 10, seed: 'fixed' }), history };
  assert.equal(E.derive(s).finalists, null);
  assert.equal(key(...E.nextPair(s)), key(all[1], all[2]));
});

test('a forced rematch is the least-recent pair, never the one just played', () => {
  // Everyone has met everyone once; the most recent meetings must not repeat.
  const all = ids(14);
  const history = [];
  for (let i = 0; i < 14; i++) for (let j = i + 1; j < 14; j++) history.push({ a: all[i], b: all[j], result: 'both' });
  let s = { ...E.newSession(all, { count: 1, lives: 10, seed: 'fixed' }), history };
  const recent = new Set(history.slice(-3).map(({ a, b }) => key(a, b)));
  for (let i = 0; i < 5; i++) {
    const [a, b] = E.nextPair(s);
    assert.ok(!recent.has(key(a, b)), `rematched recent pair ${key(a, b)}`);
    recent.add(key(a, b));
    s = E.decide(s, { a, b, result: 'both' });
  }
});
