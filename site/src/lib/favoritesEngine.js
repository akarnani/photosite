// Pairwise "pick the better photo" selection (pure logic, no I/O).
//
// A session is { ids, count, lives, seed, history } and runs in two phases:
//
// 1. Cull. Every photo starts with `lives` lives and loses one each time it
//    loses a matchup; it's out when they run out, so one unlucky pairing never
//    eliminates a photo. Pairing is Swiss-style: the least-played photo meets
//    the closest loss record it hasn't faced yet. A pair never meets twice
//    while any two surviving photos still haven't met — otherwise one photo
//    could lose both lives to the same rival. This runs until only
//    `finalists` photos (≈2× count) remain — cheap, and good at dropping the
//    clearly-not-favorites, but too blunt to pick the exact top N because the
//    survivors end up knocking each other out.
// 2. Final. The finalists get a strength score (Bradley-Terry fit over their
//    final-phase matchups) and keep playing, with the most matchups spent on
//    photos ranked near the cut line, until each has played enough. The top
//    `count` by score are the favorites.
//
// Subject mode: with `groups` ([{ name, ids }]), each group is its own little
// game — photos only ever meet others from their group, `count` is per group,
// and groups are played one after another (biggest first). Each group replays
// as an ordinary session over its photos and the history entries between
// them, seeded with `<seed>|<group name>`.
//
// Subject mode + `total`: once every group is done, their favorites play one
// more game across subjects (seeded `<seed>|across`) down to `total` overall,
// so whole subjects can drop out — but only at the end, after each has been
// judged on its own terms. Those picks carry `across: true` (added by
// `decide`), which keeps them out of the subject games' replays even when
// both photos share a subject.
//
// All state is derived by replaying `history`, so undo is a pop and changing
// `count`/`lives` on resume just re-derives. Pairing is a pure function of
// (seed, history): the same seed gives everyone the same first round, and the
// next pair can be predicted so images can be prefetched.
//
// Shared by the CLI (`photosite favorites`) and the site's /favorites/ page,
// so it must stay dependency-free and browser-safe.

// Decision results: 'a' / 'b' (that side wins), 'both' (both good — no lives
// lost; a tie in the final), 'neither' (both lose a life; a tie in the final).
export const RESULTS = new Set(['a', 'b', 'both', 'neither']);

// 32-bit FNV-1a string hash, finished with a murmur-style mix.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Seeded per-photo tiebreak in [0, 1). Ties are broken by this instead of a
// per-pick random number, so the whole first round depends only on the seed —
// two people with the same seed see the same opening matchups whatever they
// pick, and diverge only as their records differ.
const tiebreak = (session, id) => hash(`${session.seed}|${id}`) / 4294967296;

// Short, stable code for a photo (for share links that survive new photos).
export const photoCode = (id) => hash(id).toString(36).padStart(7, '0').slice(-5);

const SEED_WORDS = [
  'manta', 'reef', 'nudi', 'coral', 'turtle', 'kelp', 'squid', 'wrasse', 'goby', 'eel', 'ray', 'shrimp',
  'blenny', 'lagoon', 'drift', 'current', 'wreck', 'pinnacle', 'anemone', 'clown', 'cuttle', 'octo', 'puffer', 'grouper',
];

// A friendly random seed like "manta-wreck-42".
export function randomSeed() {
  const w = () => SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  return `${w()}-${w()}-${Math.floor(Math.random() * 90 + 10)}`;
}

// `ids` are sorted so the same photo set gives the same session everywhere.
// `groups` ([{ name, ids }], optional) turns on subject mode: it's narrowed to
// `ids`, photos in no group go to "Other", and groups play biggest first.
export function newSession(ids, { count, lives, seed = randomSeed(), groups = null, total = 0 }) {
  const sorted = [...ids].sort();
  const session = { version: 2, ids: sorted, count, lives, seed: String(seed), history: [] };
  if (groups) session.groups = normalizeGroups(sorted, groups);
  if (groups && total > 0) session.total = total;
  return session;
}

export function normalizeGroups(ids, groups) {
  const inSet = new Set(ids);
  const seen = new Set();
  const out = [];
  for (const g of groups) {
    const gi = [...new Set(g.ids)].filter((id) => inSet.has(id) && !seen.has(id)).sort();
    gi.forEach((id) => seen.add(id));
    if (gi.length) out.push({ name: String(g.name), ids: gi });
  }
  const rest = ids.filter((id) => !seen.has(id));
  if (rest.length) out.push({ name: 'Other', ids: rest });
  return out.sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
}

// One group as a plain session (history narrowed to matchups inside it).
function groupSession(session, g) {
  const inG = new Set(g.ids);
  return {
    version: session.version,
    ids: g.ids,
    count: Math.min(session.count, g.ids.length),
    lives: session.lives,
    seed: `${session.seed}|${g.name}`,
    subject: true,
    history: session.history.filter((h) => !h.across && inG.has(h.a) && inG.has(h.b)),
  };
}

// The across-subjects game: every group's favorites, down to `total`.
export const ACROSS = 'Across subjects';
function acrossSession(session, parts) {
  return {
    version: session.version,
    ids: parts.flatMap((p) => winners1(p.s, p.d)).sort(),
    count: session.total,
    lives: session.lives,
    seed: `${session.seed}|across`,
    history: session.history.filter((h) => h.across),
  };
}

// How many photos make the final (phase 2). A subject's final is smaller:
// picking 1–3 from one subject doesn't need a 10-photo safety margin, and with
// two dozen subjects that margin would add hundreds of picks.
const finalCount = (total, count, subject) => Math.min(total, Math.max(count * 2, count + (subject ? 4 : 10)));
export const finalistTarget = (session) => finalCount(session.ids.length, session.count, session.subject);

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
function derive1(session) {
  // `opp`: opponent id → { n: times met, at: history index of the last meeting }.
  const stats = new Map(session.ids.map((id) => [id, { wins: 0, losses: 0, matches: 0, opp: new Map() }]));
  const F = finalistTarget(session);
  const isAlive = (id) => stats.get(id).losses < session.lives;
  let aliveCount = session.ids.length; // everyone starts with ≥1 life
  let finalists = aliveCount <= F ? [...session.ids] : null;

  session.history.forEach(({ a, b, result }, at) => {
    const sa = stats.get(a);
    const sb = stats.get(b);
    if (!sa || !sb) return; // photo no longer in the session
    sa.matches++;
    sb.matches++;
    const met = (s, o) => s.opp.set(o, { n: (s.opp.get(o)?.n || 0) + 1, at });
    met(sa, b);
    met(sb, a);
    if (finalists) return; // final-phase matchup: scored below, no lives lost
    const before = isAlive(a) + isAlive(b);
    if (result === 'a') (sa.wins++, sb.losses++);
    else if (result === 'b') (sb.wins++, sa.losses++);
    else if (result === 'neither') (sa.losses++, sb.losses++);
    aliveCount -= before - isAlive(a) - isAlive(b);
    if (aliveCount <= F) finalists = session.ids.filter(isAlive);
  });
  const alive = finalists || session.ids.filter(isAlive);
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
  // A small final (e.g. a subject with a handful of photos) is one round
  // robin instead — more games there could only be rematches.
  const cap = finalists.length - 1;
  const target = (id) => Math.min(cap, FINAL_BASE + (Math.abs(rank.get(id) - session.count + 0.5) < band ? FINAL_EXTRA : 0));
  const games_ = (id) => [...played.get(id).values()].reduce((n, x) => n + x, 0);
  const need = new Map(finalists.map((id) => [id, Math.max(0, target(id) - games_(id))]));
  return { ...d, score, ranked, rank, played, need };
}


function isDone1(session, d = derive1(session)) {
  if (!d.finalists) return false;
  if (d.finalists.length <= session.count) return true;
  return ![...d.need.values()].some((n) => n > 0);
}

// The next [left, right] pair, or null when the session is finished.
function nextPair1(session, d = derive1(session)) {
  if (isDone1(session, d)) return null;
  const tb = (id) => tiebreak(session, id);
  // Which side each photo shows on is seeded per pair too.
  const order = (a, b) => (hash(`${session.seed}|${a}|${b}`) & 1 ? [a, b] : [b, a]);
  const { stats } = d;

  // Lowest score wins: `score(id)` plus the seeded tiebreak (scores are
  // integers or scaled ≥10 apart where it matters, so ties only break ties).
  const best = (pool, score) => {
    let out = null;
    let low = Infinity;
    for (const id of pool) {
      const s = score(id) + tb(id);
      if (s < low) (out = id), (low = s);
    }
    return out;
  };

  // Rematch ordering: fewest meetings first, then the longest ago — so a
  // forced rematch is never the pair you just saw.
  const staleness = (sa, id) => {
    const met = sa.opp.get(id);
    return met ? met.n * 1e9 + (met.at + 1) * 1e3 : 0;
  };

  if (!d.finalists) {
    const { alive } = d;
    const hasUnmet = (id) => alive.some((o) => o !== id && !stats.get(id).opp.has(o));
    // Only photos that still have someone new to face can lead a matchup; a
    // rematch happens only once every surviving photo has met every other.
    let leaders = alive.filter(hasUnmet);
    const rematch = !leaders.length;
    if (rematch) leaders = alive;
    const minMatches = Math.min(...leaders.map((id) => stats.get(id).matches));
    const a = best(leaders.filter((id) => stats.get(id).matches === minMatches), () => 0);
    const sa = stats.get(a);
    const others = alive.filter((id) => id !== a);
    const pool = rematch ? others : others.filter((id) => !sa.opp.has(id));
    const b = best(
      pool,
      (id) => staleness(sa, id) + Math.abs(stats.get(id).losses - sa.losses) * 1000 + stats.get(id).matches * 10,
    );
    return order(a, b);
  }

  // Final: the finalist most short of its matchup target (ties → nearest the
  // cut line) meets the closest-scored finalist it has played least (and, among
  // ones it has already played, longest ago).
  const { finalists, need, rank, score, played } = d;
  const a = best(
    finalists.filter((id) => need.get(id) > 0),
    (id) => -need.get(id) * 1000 + Math.abs(rank.get(id) - session.count),
  );
  const la = Math.log(score.get(a));
  const sa = stats.get(a);
  const recency = (id) => (played.get(a).get(id) ? (100 * (sa.opp.get(id).at + 1)) / session.history.length : 0);
  const b = best(
    finalists.filter((id) => id !== a),
    (id) =>
      (played.get(a).get(id) || 0) * 1000 + recency(id) + Math.abs(Math.log(score.get(id)) - la) * 10 - need.get(id),
  );
  return order(a, b);
}

// Validate a decision against the current pair → error string or null.
function checkDecision1(session, { a, b, result }, d = derive1(session)) {
  const pair = nextPair1(session, d);
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

// In the across-subjects game the pick is tagged, so the subject games ignore it.
export function decide(session, { a, b, result }, d = derive(session)) {
  const across = !!d.parts?.[d.current]?.across;
  return { ...session, history: [...session.history, across ? { a, b, result, across } : { a, b, result }] };
}
export const undo = (session) => ({ ...session, history: session.history.slice(0, -1) });

// The pair that would follow each possible pick (for image prefetching).
export function upcomingPairs(session) {
  const d = derive(session);
  const pair = nextPair(session, d);
  if (!pair) return [];
  const [a, b] = pair;
  return ['a', 'b']
    .map((result) => nextPair(decide(session, { a, b, result }, d)))
    .filter(Boolean);
}

// Rough picks remaining. Cull: each pick costs about one life, and every photo
// beyond the finalist target has to spend all of its remaining lives. Final:
// each pick covers two photos' outstanding matchups.
function progress1(session, d = derive1(session)) {
  const { stats, alive } = d;
  const F = finalistTarget(session);
  const finalPicks = (n) => Math.ceil((n * Math.min(n - 1, FINAL_BASE + FINAL_EXTRA / 2)) / 2);
  let remaining;
  if (d.finalists) {
    remaining = isDone1(session, d) ? 0 : Math.ceil([...d.need.values()].reduce((n, x) => n + x, 0) / 2);
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

// ---- Compact history for URLs ---------------------------------------------
// The pairs are a pure function of (seed, history), so a game is fully
// described by its sequence of results: 2 bits each, three per base64url
// character, as "<count>.<chars>". Anyone opening the link replays to exactly
// the same position — same next matchup, same standings.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RESULT_LIST = ['a', 'b', 'both', 'neither'];

export function encodeHistory(history) {
  let chars = '';
  for (let i = 0; i < history.length; i += 3) {
    let v = 0;
    for (let j = 0; j < 3; j++) v = v * 4 + Math.max(0, RESULT_LIST.indexOf(history[i + j]?.result));
    chars += B64[v];
  }
  return `${history.length}.${chars}`;
}

// Replay encoded results against `session`'s own pairing → a history. Stops
// early at a result that no longer applies (e.g. the photo set has changed).
export function decodeHistory(session, code) {
  const m = /^(\d+)\.([A-Za-z0-9_-]*)$/.exec(code || '');
  if (!m) return [];
  const n = Math.min(Number(m[1]), m[2].length * 3);
  let s = { ...session, history: [] };
  for (let i = 0; i < n; i++) {
    const v = B64.indexOf(m[2][Math.floor(i / 3)]);
    const result = RESULT_LIST[(v >> (2 * (2 - (i % 3)))) & 3];
    const d = derive(s);
    const pair = nextPair(s, d);
    if (!pair) break;
    const decision = { a: pair[0], b: pair[1], result };
    if (checkDecision(s, decision, d)) break;
    s = decide(s, decision, d);
  }
  return s.history;
}

// Short fingerprint of a photo set, so a link can tell when the photos (and
// therefore the matchups) have changed since it was made.
export const scopeCode = (ids) => photoCode([...ids].sort().join('|'));

// Rough total picks for a fresh session (for "how long will this take?").
// `total` may be a list of group sizes (subject mode; `count` is per group).
// `overall` (subject mode): then narrow the groups' favorites to that many.
export function estimatePicks(total, count, lives, subject = false, overall = 0) {
  if (Array.isArray(total)) {
    const groups = total.reduce((n, t) => n + estimatePicks(t, count, lives, true), 0);
    const pool = total.reduce((n, t) => n + Math.min(count, t), 0);
    return groups + (overall > 0 ? estimatePicks(pool, overall, lives) : 0);
  }
  const F = finalCount(total, count, subject);
  if (total <= count) return 0;
  return Math.ceil((total - F) * lives + (F * Math.min(F - 1, FINAL_BASE + FINAL_EXTRA / 2)) / 2);
}

// The favorites: the top `count` finalists by score (all of them if the final
// has `count` or fewer). Before the final, the best-performing alive photos.
function winners1(session, d = derive1(session)) {
  if (d.finalists) return d.ranked.slice(0, session.count);
  const s = (id) => d.stats.get(id).wins - d.stats.get(id).losses;
  return [...d.alive].sort((x, y) => s(y) - s(x)).slice(0, session.count);
}

// ---- Public API (plain or subject mode) -----------------------------------

// Plain: the single game's state. Subject mode: { parts: [{ name, s, d }],
// current } — `current` is the index of the group being played (or -1 when
// all are finished).
export function derive(session) {
  if (!session.groups) return derive1(session);
  const parts = session.groups.map((g) => {
    const s = groupSession(session, g);
    return { name: g.name, s, d: derive1(s) };
  });
  let current = parts.findIndex((p) => !isDone1(p.s, p.d));
  if (current < 0 && session.total) {
    const s = acrossSession(session, parts);
    parts.push({ name: ACROSS, s, d: derive1(s), across: true });
    if (!isDone1(s, parts.at(-1).d)) current = parts.length - 1;
  }
  return { parts, current };
}

export function isDone(session, d = derive(session)) {
  return session.groups ? d.current < 0 : isDone1(session, d);
}

// The next [left, right] pair, or null when the session is finished.
export function nextPair(session, d = derive(session)) {
  if (!session.groups) return nextPair1(session, d);
  const p = d.parts[d.current];
  return p ? nextPair1(p.s, p.d) : null;
}

// Validate a decision against the current pair → error string or null.
export function checkDecision(session, decision, d = derive(session)) {
  if (!session.groups) return checkDecision1(session, decision, d);
  const p = d.parts[d.current];
  return p ? checkDecision1(p.s, decision, p.d) : 'Session is already finished';
}

// Progress of the current game (in subject mode: the current group, plus
// `group`, `groupIndex`, `groups` and `remaining` summed over every group).
export function progress(session, d = derive(session)) {
  if (!session.groups) return progress1(session, d);
  const i = d.current < 0 ? d.parts.length - 1 : d.current;
  const cur = progress1(d.parts[i].s, d.parts[i].d);
  let remaining = d.parts.reduce((n, p) => n + progress1(p.s, p.d).remaining, 0);
  const subjects = d.parts.filter((p) => !p.across);
  // The across game doesn't exist until the subjects are done: estimate it.
  if (session.total && subjects.length === d.parts.length) {
    const pool = subjects.reduce((n, p) => n + Math.min(p.s.count, p.s.ids.length), 0);
    remaining += estimatePicks(pool, session.total, session.lives);
  }
  return {
    ...cur,
    decisions: session.history.length,
    remaining,
    group: d.parts[i].name,
    groupIndex: i,
    groups: subjects.length,
    across: !!d.parts[i].across,
  };
}

// The favorites. Plain: the top `count` (see winners1). Subject mode: each
// group's top `count`, in group order — or, with `total`, the across game's
// top `total` once it has started.
export function winners(session, d = derive(session)) {
  return winnersByGroup(session, d).flatMap((g) => g.ids);
}

// Subject mode: [{ name, ids }] of each group's favorites (with `total`,
// only the ones still in the across game; subjects left empty are dropped).
// Plain: one group.
export function winnersByGroup(session, d = derive(session)) {
  if (!session.groups) return [{ name: null, ids: winners1(session, d) }];
  const across = d.parts.find((p) => p.across);
  const keep = across && new Set(winners1(across.s, across.d));
  return d.parts
    .filter((p) => !p.across)
    .map((p) => ({ name: p.name, ids: winners1(p.s, p.d).filter((id) => !keep || keep.has(id)) }))
    .filter((g) => g.ids.length);
}

// Fingerprint of everything that decides the matchups besides the seed: the
// photo set, and in subject mode how it's grouped.
export const sessionScope = (session) =>
  session.groups ? photoCode(session.groups.map((g) => `${g.name}:${g.ids.join('|')}`).join('/')) : scopeCode(session.ids);
