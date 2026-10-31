// Pairwise "pick the better photo" selection (pure logic, no I/O).
//
// A session is { ids, count, lives, seed, history } and runs in two phases:
//
// 1. Cull. Every photo starts with `lives` lives and loses one each time it
//    loses a matchup; it's out when they run out, so one unlucky pairing never
//    eliminates a photo. Pairing is Swiss-style: the least-played photo meets
//    the closest loss record it hasn't faced yet. This runs until only
//    `finalists` photos (≈2× count) remain — cheap, and good at dropping the
//    clearly-not-favorites, but too blunt to pick the exact top N because the
//    survivors end up knocking each other out.
// 2. Final. The finalists get a strength score (Bradley-Terry fit over their
//    final-phase matchups) and keep playing, with the most matchups spent on
//    photos ranked near the cut line, until each has played enough. The top
//    `count` by score are the favorites.
//
// All state is derived by replaying `history`, so undo is a pop and changing
// `count`/`lives` on resume just re-derives. Pairing uses a PRNG seeded from
// (seed, history length), so the next pair is deterministic — the server can
// predict upcoming pairs and the browser can prefetch their images.

// Decision results: 'a' / 'b' (that side wins), 'both' (both good — no lives
// lost; a tie in the final), 'neither' (both lose a life; a tie in the final).
export const RESULTS = new Set(['a', 'b', 'both', 'neither']);

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rngFor = (session) => mulberry32((session.seed * 2654435761 + session.history.length) >>> 0);

export function newSession(ids, { count, lives }) {
  return { version: 1, ids, count, lives, seed: Math.floor(Math.random() * 2 ** 31), history: [] };
}

// How many photos make the final (phase 2).
export const finalistTarget = (session) => Math.min(session.ids.length, Math.max(session.count * 2, session.count + 10));

// Final-phase matchups per finalist; photos near the cut line get extra.
const FINAL_BASE = 4;
const FINAL_EXTRA = 4;

// Bradley-Terry strengths (MM algorithm) from [winner-share, a, b] records.
// Each photo also gets one virtual win and loss against an average opponent,
// which keeps scores finite and stops a single lucky win from dominating.
function bradleyTerry(ids, games) {
  const p = new Map(ids.map((id) => [id, 1]));
  const wins = new Map(ids.map((id) => [id, 1]));
  for (const [wa, a, b] of games) {
    wins.set(a, wins.get(a) + wa);
    wins.set(b, wins.get(b) + 1 - wa);
  }
  for (let iter = 0; iter < 60; iter++) {
    const denom = new Map(ids.map((id) => [id, 2 / (p.get(id) + 1)]));
    for (const [, a, b] of games) {
      const d = 1 / (p.get(a) + p.get(b));
      denom.set(a, denom.get(a) + d);
      denom.set(b, denom.get(b) + d);
    }
    for (const id of ids) p.set(id, wins.get(id) / denom.get(id));
  }
  return p;
}

const share = { a: 1, b: 0, both: 0.5, neither: 0.5 };

// Replay history → per-photo cull stats, the alive list (in `ids` order), and
// — once the cull is over — the finalists with their scores, ranks and
// final-phase matchup counts.
export function derive(session) {
  const stats = new Map(session.ids.map((id) => [id, { wins: 0, losses: 0, matches: 0, opp: new Set() }]));
  const F = finalistTarget(session);
  const isAlive = (id) => stats.get(id).losses < session.lives;
  let alive = session.ids.filter(isAlive);
  let finalists = alive.length <= F ? alive : null;

  for (const { a, b, result } of session.history) {
    const sa = stats.get(a);
    const sb = stats.get(b);
    if (!sa || !sb) continue; // photo no longer in the session
    sa.matches++;
    sb.matches++;
    sa.opp.add(b);
    sb.opp.add(a);
    if (finalists) continue; // final-phase matchup: scored below, no lives lost
    if (result === 'a') (sa.wins++, sb.losses++);
    else if (result === 'b') (sb.wins++, sa.losses++);
    else if (result === 'neither') (sa.losses++, sb.losses++);
    alive = session.ids.filter(isAlive);
    if (alive.length <= F) finalists = alive;
  }
  const d = { stats, alive, finalists };
  if (!finalists) return d;

  // Every matchup between two finalists counts, cull-phase ones included.
  const inFinal = new Set(finalists);
  const games = [];
  const played = new Map(finalists.map((id) => [id, new Map()]));
  for (const { a, b, result } of session.history) {
    if (!inFinal.has(a) || !inFinal.has(b)) continue;
    games.push([share[result], a, b]);
    played.get(a).set(b, (played.get(a).get(b) || 0) + 1);
    played.get(b).set(a, (played.get(b).get(a) || 0) + 1);
  }
  const score = bradleyTerry(finalists, games);
  const ranked = [...finalists].sort((x, y) => score.get(y) - score.get(x));
  const rank = new Map(ranked.map((id, i) => [id, i]));
  const band = Math.max(2, Math.round(session.count / 4));
  const target = (id) => FINAL_BASE + (Math.abs(rank.get(id) - session.count + 0.5) < band ? FINAL_EXTRA : 0);
  const games_ = (id) => [...played.get(id).values()].reduce((n, x) => n + x, 0);
  const need = new Map(finalists.map((id) => [id, Math.max(0, target(id) - games_(id))]));
  return { ...d, score, ranked, rank, played, need };
}

export const inFinal = (d) => Boolean(d.finalists);

export function isDone(session, d = derive(session)) {
  if (!d.finalists) return false;
  if (d.finalists.length <= session.count) return true;
  return ![...d.need.values()].some((n) => n > 0);
}

// The next [left, right] pair, or null when the session is finished.
export function nextPair(session, d = derive(session)) {
  if (isDone(session, d)) return null;
  const rng = rngFor(session);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const order = (a, b) => (rng() < 0.5 ? [a, b] : [b, a]);
  const { stats } = d;

  // Lowest score wins: `score(id)` with a random tiebreak.
  const best = (pool, score) => {
    let out = null;
    let low = Infinity;
    for (const id of pool) {
      const s = score(id) + rng();
      if (s < low) (out = id), (low = s);
    }
    return out;
  };

  if (!d.finalists) {
    const { alive } = d;
    const minMatches = Math.min(...alive.map((id) => stats.get(id).matches));
    const a = pick(alive.filter((id) => stats.get(id).matches === minMatches));
    const sa = stats.get(a);
    let pool = alive.filter((id) => id !== a && !sa.opp.has(id));
    if (!pool.length) pool = alive.filter((id) => id !== a); // everyone met; allow a rematch
    const b = best(pool, (id) => Math.abs(stats.get(id).losses - sa.losses) * 1000 + stats.get(id).matches * 10);
    return order(a, b);
  }

  // Final: the finalist most short of its matchup target (ties → nearest the
  // cut line) meets the closest-scored finalist it has played least.
  const { finalists, need, rank, score, played } = d;
  const a = best(
    finalists.filter((id) => need.get(id) > 0),
    (id) => -need.get(id) * 1000 + Math.abs(rank.get(id) - session.count),
  );
  const la = Math.log(score.get(a));
  const b = best(
    finalists.filter((id) => id !== a),
    (id) => (played.get(a).get(id) || 0) * 1000 + Math.abs(Math.log(score.get(id)) - la) * 10 - need.get(id),
  );
  return order(a, b);
}

// Validate a decision against the current pair → error string or null.
export function checkDecision(session, { a, b, result }, d = derive(session)) {
  const pair = nextPair(session, d);
  if (!pair) return 'Session is already finished';
  if (pair[0] !== a || pair[1] !== b) return 'Stale pair — reload the page';
  if (!RESULTS.has(result)) return `Unknown result "${result}"`;
  if (result === 'neither' && !d.finalists) {
    const out = [a, b].filter((id) => d.stats.get(id).losses + 1 >= session.lives).length;
    if (d.alive.length - out < session.count) {
      return `That would leave fewer than ${session.count} photos — pick one`;
    }
  }
  return null;
}

export const decide = (session, decision) => ({ ...session, history: [...session.history, decision] });
export const undo = (session) => ({ ...session, history: session.history.slice(0, -1) });

// The pair that would follow each possible pick (for image prefetching).
export function upcomingPairs(session) {
  const pair = nextPair(session);
  if (!pair) return [];
  const [a, b] = pair;
  return ['a', 'b']
    .map((result) => nextPair(decide(session, { a, b, result })))
    .filter(Boolean);
}

// Rough picks remaining. Cull: each pick costs about one life, and every photo
// beyond the finalist target has to spend all of its remaining lives. Final:
// each pick covers two photos' outstanding matchups.
export function progress(session, d = derive(session)) {
  const { stats, alive } = d;
  const F = finalistTarget(session);
  const finalPicks = (n) => Math.ceil((n * (FINAL_BASE + FINAL_EXTRA / 2)) / 2);
  let remaining;
  if (d.finalists) {
    remaining = isDone(session, d) ? 0 : Math.ceil([...d.need.values()].reduce((n, x) => n + x, 0) / 2);
  } else {
    const livesLeft = alive.reduce((n, id) => n + (session.lives - stats.get(id).losses), 0);
    remaining = Math.ceil((alive.length - F) * (livesLeft / alive.length)) + finalPicks(F);
  }
  return {
    phase: d.finalists ? 'final' : 'cull',
    total: session.ids.length,
    alive: d.finalists ? d.finalists.length : alive.length,
    finalists: F,
    decisions: session.history.length,
    remaining,
  };
}

// The favorites: the top `count` finalists by score (all of them if the final
// has `count` or fewer). Before the final, the best-performing alive photos.
export function winners(session, d = derive(session)) {
  if (d.finalists) return d.ranked.slice(0, session.count);
  const s = (id) => d.stats.get(id).wins - d.stats.get(id).losses;
  return [...d.alive].sort((x, y) => s(y) - s(x)).slice(0, session.count);
}
