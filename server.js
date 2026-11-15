const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const C = require("./content");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.send("ok"));

// ---------- Hilfsfunktionen ----------
const rooms = new Map();
const rid = (n = 8) => crypto.randomBytes(n).toString("hex");
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
function makeCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c; do { c = Array.from({ length: 4 }, () => pick(L)).join(""); } while (rooms.has(c));
  return c;
}

const TIMES = { insider: 75, answer: 60, draw: 80, vote: 30, guess: 35, likely: 25, reveal: 45 };
const PTS = { vote: 100, house: -100, guess: 50, likely: 100 };

function connectedPlayers(room) { return [...room.players.values()].filter((p) => p.connected); }

function fillNames(room, text, fixed) {
  const names = shuffle([...room.players.values()].map((p) => p.name));
  const a = fixed?.a || names[0] || "Jemand";
  const b = fixed?.b || names.find((n) => n !== a) || "Jemand anderes";
  return { text: text.replaceAll("[Spieler2]", b).replaceAll("[Spieler]", a), a, b };
}

function buildRoundPlan(n, withDraw) {
  const base = withDraw
    ? ["answer", "answer", "likely", "draw", "answer", "likely", "answer", "draw", "answer", "likely", "draw", "answer", "answer", "likely"]
    : ["answer", "answer", "likely", "answer", "answer", "likely", "answer", "answer", "likely", "answer", "answer", "likely", "answer", "answer"];
  const plan = base.slice(0, n - 1);
  plan.push("answer"); // Finale: immer Antwort-Runde mit doppelten Punkten
  return plan;
}

// ---------- Zustand an Clients senden ----------
function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected, isHost: p.id === room.hostId,
  }));
}

function stateFor(room, me) {
  const r = room.round;
  const s = {
    code: room.code, phase: room.phase, players: publicPlayers(room), hostId: room.hostId,
    settings: room.settings, me: me ? { id: me.id } : null,
    remaining: room.deadline ? Math.max(0, room.deadline - Date.now()) : null,
    totalTime: room.phaseDuration || null,
    roundNo: room.roundIdx + 1, roundCount: room.plan.length,
    done: [...room.done],
    customCount: room.custom.length,
  };
  if (r) {
    s.round = { type: r.type, prompt: r.prompt, final: r.final, mult: r.mult };
    if (["vote", "guess"].includes(room.phase)) {
      s.round.entries = r.entries.map((e) => ({ id: e.id, text: e.text, drawing: e.drawing, mine: me && e.author === me.id }));
    }
    if (room.phase === "likely") s.round.options = publicPlayers(room).filter((p) => p.connected || r.voters.has(p.id));
    if (room.phase === "reveal") s.round.result = r.result;
  }
  if (room.phase === "final") s.final = room.final;
  return s;
}

function emitState(room) {
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit("state", stateFor(room, p));
  }
}
function emitProgress(room) {
  io.to(room.code).emit("progress", { done: [...room.done], players: publicPlayers(room) });
}

// ---------- Phasensteuerung ----------
function setPhase(room, phase, seconds) {
  clearTimeout(room.timer);
  room.phase = phase;
  room.done = new Set();
  room.phaseDuration = seconds ? seconds * 1000 : null;
  room.deadline = seconds ? Date.now() + seconds * 1000 : null;
  if (seconds) room.timer = setTimeout(() => endPhase(room), seconds * 1000 + 300);
  emitState(room);
}

function checkAllDone(room) {
  const active = connectedPlayers(room);
  if (active.length && active.every((p) => room.done.has(p.id))) endPhase(room);
  else emitProgress(room);
}

function endPhase(room) {
  clearTimeout(room.timer);
  const r = room.round;
  switch (room.phase) {
    case "insider": return startRound(room, 0);
    case "prompt": return startVote(room);
    case "vote": return startGuess(room);
    case "guess": return reveal(room);
    case "likely": return revealLikely(room);
    case "reveal": return nextRound(room);
  }
}

function startGame(room) {
  for (const p of room.players.values()) {
    p.score = 0;
    p.stats = { votesReceived: 0, correctGuesses: 0, housePicks: 0, likelyPicked: 0, answered: 0 };
  }
  room.custom = [];
  room.plan = buildRoundPlan(room.settings.rounds, room.settings.draw);
  room.used = { answer: new Set(), likely: new Set(), draw: new Set() };
  room.round = null;
  room.roundIdx = -1;
  if (room.settings.insider) setPhase(room, "insider", TIMES.insider);
  else startRound(room, 0);
}

function nextFrom(list, usedSet) {
  let idx = list.map((_, i) => i).filter((i) => !usedSet.has(i));
  if (!idx.length) { usedSet.clear(); idx = list.map((_, i) => i); }
  const i = pick(idx); usedSet.add(i); return list[i];
}

function startRound(room, idx) {
  room.roundIdx = idx;
  const type = room.plan[idx];
  const final = idx === room.plan.length - 1;
  const r = { type, final, mult: final ? 2 : 1, answers: new Map(), votes: new Map(), guesses: new Map(), voters: new Map() };

  if (type === "answer") {
    // Insider-Fragen haben Vorrang, aber gemischt mit dem Katalog
    let base;
    if (room.custom.length && (Math.random() < 0.6 || final)) {
      const c = room.custom.splice(Math.floor(Math.random() * room.custom.length), 1)[0];
      base = { q: c.q, fake: pick(C.genericFakes), custom: c.by };
    } else base = nextFrom(C.answerPrompts, room.used.answer);
    const f = fillNames(room, base.q);
    r.prompt = f.text;
    r.fake = fillNames(room, base.fake, f).text;
    r.customBy = base.custom || null;
    room.round = r;
    setPhase(room, "prompt", TIMES.answer);
  } else if (type === "draw") {
    r.prompt = fillNames(room, nextFrom(C.drawPrompts, room.used.draw)).text;
    room.round = r;
    setPhase(room, "prompt", TIMES.draw);
  } else {
    r.prompt = fillNames(room, nextFrom(C.likelyPrompts, room.used.likely)).text;
    room.round = r;
    setPhase(room, "likely", TIMES.likely);
  }
}

function startVote(room) {
  const r = room.round;
  r.entries = [...r.answers.entries()].map(([author, a]) => ({ id: rid(4), author, text: a.text || null, drawing: a.drawing || null }));
  if (r.type === "answer") r.entries.push({ id: rid(4), author: "HOUSE", text: r.fake, drawing: null });
  r.entries = shuffle(r.entries);
  const playerEntries = r.entries.filter((e) => e.author !== "HOUSE");
  if (playerEntries.length < 2 && r.type === "draw") { r.entries = playerEntries; return reveal(room); }
  if (!playerEntries.length) return reveal(room);
  setPhase(room, "vote", TIMES.vote);
}

function startGuess(room) {
  const r = room.round;
  // Wer-war's nur sinnvoll, wenn es mindestens 2 fremde Einträge gibt
  if (r.entries.length < 3) return reveal(room);
  setPhase(room, "guess", TIMES.guess);
  // Spieler ohne fremde Einträge automatisch fertig
  for (const p of connectedPlayers(room)) if (!r.entries.some((e) => e.author !== p.id)) room.done.add(p.id);
  if (room.done.size) checkAllDone(room);
}

function reveal(room) {
  const r = room.round;
  const delta = {};
  const add = (id, n) => { const p = room.players.get(id); if (!p) return; p.score += n; delta[id] = (delta[id] || 0) + n; };
  const entries = (r.entries || []).map((e) => ({ ...e, voters: [], guessedBy: [], wrongGuesses: [] }));
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

  for (const [voter, entryId] of r.votes) {
    const e = byId[entryId]; if (!e) continue;
    e.voters.push(voter);
    if (e.author === "HOUSE") { add(voter, PTS.house * r.mult); room.players.get(voter) && room.players.get(voter).stats.housePicks++; }
    else { add(e.author, PTS.vote * r.mult); const a = room.players.get(e.author); if (a) a.stats.votesReceived++; }
  }
  for (const [guesser, g] of r.guesses) {
    for (const [entryId, who] of Object.entries(g)) {
      const e = byId[entryId]; if (!e || e.author === guesser) continue;
      if (who === e.author) { e.guessedBy.push(guesser); add(guesser, PTS.guess * r.mult); const p = room.players.get(guesser); if (p) p.stats.correctGuesses++; }
      else e.wrongGuesses.push({ guesser, who });
    }
  }
  entries.sort((a, b) => b.voters.length - a.voters.length);
  r.result = { kind: "entries", entries, delta, customBy: r.customBy ? room.players.get(r.customBy)?.name || null : null };
  setPhase(room, "reveal", TIMES.reveal);
}

function revealLikely(room) {
  const r = room.round;
  const counts = {};
  for (const target of r.voters.values()) counts[target] = (counts[target] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const winners = Object.keys(counts).filter((k) => counts[k] === max && max > 0);
  const delta = {};
  for (const [voter, target] of r.voters) {
    if (winners.includes(target)) { const p = room.players.get(voter); if (p) { p.score += PTS.likely * r.mult; delta[voter] = PTS.likely * r.mult; } }
  }
  for (const w of winners) { const p = room.players.get(w); if (p) p.stats.likelyPicked += counts[w]; }
  r.result = { kind: "likely", counts, winners, votes: Object.fromEntries(r.voters), delta };
  setPhase(room, "reveal", TIMES.reveal);
}

function nextRound(room) {
  if (room.roundIdx + 1 < room.plan.length) return startRound(room, room.roundIdx + 1);
  finish(room);
}

function finish(room) {
  const ps = [...room.players.values()];
  const ranking = [...ps].sort((a, b) => b.score - a.score).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }));
  const titles = [];
  const best = (key, title, desc, min = 1) => {
    const top = [...ps].sort((a, b) => b.stats[key] - a.stats[key])[0];
    if (top && top.stats[key] >= min) titles.push({ id: top.id, title, desc: desc.replace("#", top.stats[key]) });
  };
  best("votesReceived", "👑 König der Lügen", "# Stimmen für die eigenen Antworten");
  best("correctGuesses", "🕵️ Meisterdetektiv", "# Mal richtig geraten, wer was geschrieben hat");
  best("housePicks", "🏠 Opfer des Hauses", "# Mal auf die Haus-Antwort reingefallen");
  best("likelyPicked", "🎯 Zielscheibe der Gruppe", "# Mal bei „Wer würde am ehesten…“ gewählt");
  const last = ranking[ranking.length - 1];
  room.final = { ranking, titles, loser: last && ranking.length > 1 ? { id: last.id, name: last.name, penalty: pick(C.penalties) } : null };
  room.round = null;
  setPhase(room, "final", 0);
}

function backToLobby(room) {
  clearTimeout(room.timer);
  for (const [id, p] of room.players) { if (!p.connected) room.players.delete(id); else p.score = 0; }
  room.round = null; room.final = null; room.roundIdx = -1;
  setPhase(room, "lobby", 0);
}

function ensureHost(room) {
  const h = room.players.get(room.hostId);
  if (!h || !h.connected) { const n = connectedPlayers(room)[0]; if (n) room.hostId = n.id; }
}

// ---------- Socket-Events ----------
io.on("connection", (socket) => {
  let room = null, me = null;

  function attach(r, p) {
    room = r; me = p;
    p.socketId = socket.id; p.connected = true;
    socket.join(r.code);
    ensureHost(r);
    socket.emit("joined", { code: r.code, playerId: p.id, token: p.token });
    emitState(r);
  }

  function newPlayer(r, name, avatar) {
    let n = clean(name, 16) || "Namenlos";
    const names = new Set([...r.players.values()].map((p) => p.name.toLowerCase()));
    let base = n, i = 2; while (names.has(n.toLowerCase())) n = `${base}${i++}`;
    const p = { id: rid(), token: rid(16), name: n, avatar: C.avatars.includes(avatar) ? avatar : pick(C.avatars), score: 0, connected: true,
      stats: { votesReceived: 0, correctGuesses: 0, housePicks: 0, likelyPicked: 0, answered: 0 } };
    r.players.set(p.id, p);
    return p;
  }

  socket.on("create", ({ name, avatar }) => {
    const code = makeCode();
    const r = { code, players: new Map(), hostId: null, phase: "lobby", settings: { rounds: 8, draw: true, insider: true },
      plan: [], roundIdx: -1, round: null, done: new Set(), custom: [], deadline: null, timer: null };
    rooms.set(code, r);
    const p = newPlayer(r, name, avatar);
    r.hostId = p.id;
    attach(r, p);
  });

  socket.on("join", ({ code, name, avatar }) => {
    const r = rooms.get(clean(code, 4).toUpperCase());
    if (!r) return socket.emit("err", "Raum nicht gefunden. Code richtig?");
    if (r.phase !== "lobby") return socket.emit("err", "Das Spiel läuft schon. Wartet auf die nächste Runde.");
    if (r.players.size >= 10) return socket.emit("err", "Raum ist voll (max. 10).");
    attach(r, newPlayer(r, name, avatar));
  });

  socket.on("rejoin", ({ code, playerId, token }) => {
    const r = rooms.get(String(code || "").toUpperCase());
    const p = r && r.players.get(playerId);
    if (!p || p.token !== token) return socket.emit("rejoinFailed");
    attach(r, p);
  });

  const isHost = () => room && me && room.hostId === me.id;

  socket.on("settings", (s) => {
    if (!isHost() || room.phase !== "lobby") return;
    room.settings = {
      rounds: Math.min(15, Math.max(4, parseInt(s.rounds) || 8)),
      draw: !!s.draw, insider: !!s.insider,
    };
    emitState(room);
  });

  socket.on("avatar", (a) => {
    if (!room || room.phase !== "lobby" || !C.avatars.includes(a)) return;
    me.avatar = a; emitState(room);
  });

  socket.on("start", () => {
    if (!isHost() || room.phase !== "lobby") return;
    if (connectedPlayers(room).length < 3) return socket.emit("err", "Mindestens 3 Spieler nötig.");
    startGame(room);
  });

  socket.on("kick", (id) => {
    if (!isHost() || room.phase !== "lobby" || id === me.id) return;
    const p = room.players.get(id); if (!p) return;
    if (p.socketId) io.to(p.socketId).emit("kicked");
    room.players.delete(id); emitState(room);
  });

  socket.on("custom", (qs) => {
    if (!room || room.phase !== "insider" || !Array.isArray(qs)) return;
    room.custom = room.custom.filter((c) => c.by !== me.id);
    for (const q of qs.slice(0, 3)) { const t = clean(q, 150); if (t.length > 4) room.custom.push({ q: t, by: me.id }); }
    room.done.add(me.id);
    checkAllDone(room);
  });

  socket.on("answer", (a) => {
    if (!room || room.phase !== "prompt") return;
    const r = room.round;
    if (r.type === "answer") {
      const t = clean(a?.text, 120); if (!t) return;
      r.answers.set(me.id, { text: t });
    } else {
      const d = String(a?.drawing || "");
      if (!d.startsWith("data:image/") || d.length > 1.5e6) return;
      r.answers.set(me.id, { drawing: d });
    }
    me.stats.answered++;
    room.done.add(me.id);
    checkAllDone(room);
  });

  socket.on("vote", (entryId) => {
    if (!room || room.phase !== "vote") return;
    const e = room.round.entries.find((x) => x.id === entryId);
    if (!e || e.author === me.id) return;
    room.round.votes.set(me.id, entryId);
    room.done.add(me.id);
    checkAllDone(room);
  });

  socket.on("guess", (g) => {
    if (!room || room.phase !== "guess" || typeof g !== "object") return;
    const clean = {};
    for (const e of room.round.entries) if (e.author !== me.id && typeof g[e.id] === "string") clean[e.id] = g[e.id];
    room.round.guesses.set(me.id, clean);
    room.done.add(me.id);
    checkAllDone(room);
  });

  socket.on("likely", (target) => {
    if (!room || room.phase !== "likely" || !room.players.has(target)) return;
    room.round.voters.set(me.id, target);
    room.done.add(me.id);
    checkAllDone(room);
  });

  socket.on("next", () => { if (isHost() && room.phase === "reveal") endPhase(room); });
  socket.on("skip", () => { if (isHost() && ["insider", "prompt", "vote", "guess", "likely"].includes(room.phase)) endPhase(room); });
  socket.on("lobby", () => { if (isHost() && room.phase === "final") backToLobby(room); });

  socket.on("disconnect", () => {
    if (!room || !me || me.socketId !== socket.id) return;
    me.connected = false; me.socketId = null;
    if (room.phase === "lobby") room.players.delete(me.id);
    ensureHost(room);
    if (!connectedPlayers(room).length) {
      const r = room;
      r.cleanup = setTimeout(() => { if (!connectedPlayers(r).length) rooms.delete(r.code); }, 15 * 60 * 1000);
      return;
    }
    emitState(room);
    if (["insider", "prompt", "vote", "guess", "likely"].includes(room.phase)) checkAllDone(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Lügenbaron läuft auf http://localhost:${PORT}`));
