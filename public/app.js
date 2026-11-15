(() => {
const AVATARS = ["💀","🤡","👻","🐸","🦄","🍆","🧟","👽","🐷","🦖","🍕","🧠","🤖","🐙","🥴","😈","🧛","🦝","🐌","🍑"];
const socket = io();
const app = document.getElementById("app");
let S = null;          // letzter Zustand vom Server
let viewKey = "";      // verhindert, dass Eingaben beim Neuzeichnen verloren gehen
let deadline = null, total = null;
let local = { avatar: localStorage.getItem("lb_avatar") || AVATARS[Math.floor(Math.random() * AVATARS.length)], name: localStorage.getItem("lb_name") || "" };
let muted = localStorage.getItem("lb_muted") === "1";

// ---------- DOM-Helfer (alles per textContent, kein HTML-Injection-Risiko) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const $ = (id) => document.getElementById(id);
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2800); }
const player = (id) => S?.players.find((p) => p.id === id);
const pname = (id) => id === "HOUSE" ? "🏠 Das Haus" : (player(id) ? `${player(id).avatar} ${player(id).name}` : "???");
const isHost = () => S && S.me && S.hostId === S.me.id;
const iAmDone = () => S && S.me && S.done.includes(S.me.id);

// ---------- Sound (synthetisch, keine Dateien nötig) ----------
let ac = null;
function tone(freq, dur = .12, type = "sine", vol = .15, when = 0) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
  } catch {}
}
const sfx = {
  click: () => tone(660, .06, "square", .06),
  send: () => { tone(520, .08, "triangle"); tone(780, .12, "triangle", .15, .07); },
  phase: () => { tone(330, .1, "sawtooth", .07); tone(495, .1, "sawtooth", .07, .08); tone(660, .15, "sawtooth", .07, .16); },
  tick: () => tone(1200, .04, "square", .05),
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, "triangle", .14, i * .12)),
  wah: () => [392, 370, 349, 294].forEach((f, i) => tone(f, i === 3 ? .6 : .25, "sawtooth", .08, i * .25)),
  join: () => { tone(880, .08); tone(1320, .1, "sine", .12, .06); },
};
$("muteBtn").textContent = muted ? "🔇" : "🔊";
$("muteBtn").onclick = () => { muted = !muted; localStorage.setItem("lb_muted", muted ? "1" : "0"); $("muteBtn").textContent = muted ? "🔇" : "🔊"; };

// ---------- Timer ----------
let lastTick = -1;
setInterval(() => {
  const fill = $("timerFill");
  if (!deadline || !total) { fill.style.width = "0"; return; }
  const left = Math.max(0, deadline - Date.now());
  fill.style.width = (left / total * 100) + "%";
  const sec = Math.ceil(left / 1000);
  fill.classList.toggle("low", sec <= 5);
  if (sec <= 5 && sec > 0 && sec !== lastTick && !iAmDone() && S.phase !== "reveal") { lastTick = sec; sfx.tick(); }
  const tEl = $("secs"); if (tEl) tEl.textContent = sec + "s";
}, 200);

// ---------- Konfetti ----------
function confetti(n = 160) {
  const cv = $("confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#ff4f8b", "#ffd23f", "#3ee08f", "#5ab8ff", "#b77aff"];
  const ps = Array.from({ length: n }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .5, vx: (Math.random() - .5) * 4, vy: 2 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)], s: 6 + Math.random() * 6 }));
  let frames = 0;
  (function loop() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.vy += .05; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (++frames < 260) requestAnimationFrame(loop); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

// ---------- Socket ----------
const params = new URLSearchParams(location.search);
socket.on("connect", () => {
  const saved = JSON.parse(sessionStorage.getItem("lb_session") || "null");
  if (saved) socket.emit("rejoin", saved); else if (!S) renderHome();
});
socket.on("rejoinFailed", () => { sessionStorage.removeItem("lb_session"); S = null; renderHome(); });
socket.on("joined", (d) => {
  sessionStorage.setItem("lb_session", JSON.stringify(d));
  history.replaceState(null, "", "?code=" + d.code);
});
socket.on("err", (m) => { toast(m); app.querySelector(".card")?.classList.add("shake"); setTimeout(() => app.querySelector(".shake")?.classList.remove("shake"), 900); });
socket.on("kicked", () => { sessionStorage.removeItem("lb_session"); S = null; toast("Du wurdest rausgeworfen 👢"); renderHome(); });
socket.on("disconnect", () => toast("Verbindung weg… versuche neu zu verbinden"));

socket.on("state", (s) => {
  const prev = S;
  const prevCount = prev?.players.length || 0;
  S = s;
  deadline = s.remaining != null ? Date.now() + s.remaining : null;
  total = s.totalTime;
  const key = `${s.phase}|${s.roundNo}|${s.code}`;
  if (key !== viewKey) {
    if (prev && prev.phase !== s.phase) {
      if (s.phase === "reveal") (revealHasHouseVictim() ? sfx.wah : sfx.fanfare)();
      else if (s.phase === "final") { sfx.fanfare(); confetti(); setTimeout(() => confetti(), 1200); }
      else sfx.phase();
    }
    viewKey = key; lastTick = -1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    if (s.phase === "lobby") { if (s.players.length > prevCount) sfx.join(); render(); }
    else updateLive();
  }
  renderHeader();
});
socket.on("progress", (p) => { if (!S) return; S.done = p.done; S.players = p.players; updateLive(); });

function revealHasHouseVictim() {
  const r = S.round?.result; if (!r || r.kind !== "entries") return false;
  return r.entries.some((e) => e.author === "HOUSE" && e.voters.includes(S.me.id));
}

// ---------- Header ----------
function renderHeader() {
  const ri = $("roundInfo"); ri.textContent = "";
  if (!S || ["lobby", "final"].includes(S.phase)) return;
  if (S.phase === "insider") { ri.append("Insider-Runde"); return; }
  ri.append(`Runde ${S.roundNo}/${S.roundCount} `);
  if (S.round?.final) ri.append(h("span", { class: "final" }, "· FINALE ×2"));
}

// ---------- Rendering ----------
let renderedDone = false;
function render() {
  app.textContent = "";
  renderedDone = iAmDone();
  if (!S) return renderHome();
  const views = { lobby: renderLobby, insider: renderInsider, prompt: renderPrompt, vote: renderVote, guess: renderGuess, likely: renderLikely, reveal: renderReveal, final: renderFinal };
  (views[S.phase] || (() => {}))();
  updateLive();
}

function waitingStrip() {
  return h("div", { class: "waiting", id: "waiting" }, S.players.filter((p) => p.connected).map((p) => h("span", { class: S.done.includes(p.id) ? "ok" : "", title: p.name, "data-id": p.id }, p.avatar)));
}
function updateLive() {
  if (S && S.phase !== "lobby" && iAmDone() !== renderedDone) return render();
  const w = $("waiting");
  if (w) w.replaceWith(waitingStrip());
  const st = $("doneStatus");
  if (st) { const n = S.players.filter((p) => p.connected && !S.done.includes(p.id)).length; st.textContent = n ? `Warte noch auf ${n} ${n === 1 ? "Person" : "Leute"}…` : "Alle fertig!"; }
}
function hostSkip(label = "Überspringen ⏭") {
  return isHost() ? h("div", { class: "center", style: "margin-top:10px" }, h("button", { class: "small", onclick: () => { if (confirm("Phase jetzt beenden?")) socket.emit("skip"); } }, label)) : null;
}
function doneCard(text = "Abgeschickt! 😏") {
  return h("div", { class: "card center" }, h("h2", {}, text), h("div", { class: "muted", id: "doneStatus" }), waitingStrip(), hostSkip());
}

// ---------- Start ----------
function avatarPicker(onPick) {
  return h("div", { class: "avatars" }, AVATARS.map((a) => h("button", { class: a === local.avatar ? "sel" : "", type: "button", onclick: (e) => {
    local.avatar = a; localStorage.setItem("lb_avatar", a); sfx.click();
    e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.textContent === a));
    onPick && onPick(a);
  } }, a)));
}

function renderHome() {
  viewKey = ""; app.textContent = ""; renderHeader?.();
  deadline = null;
  const name = h("input", { placeholder: "Dein Name", maxlength: 16, value: local.name, autocomplete: "off" });
  const code = h("input", { placeholder: "CODE", maxlength: 4, value: params.get("code") || "", style: "text-transform:uppercase;letter-spacing:.2em;font-weight:700;text-align:center" });
  const go = (ev) => {
    const n = name.value.trim(); if (!n) { toast("Erst einen Namen eingeben"); name.focus(); return; }
    local.name = n; localStorage.setItem("lb_name", n);
    sfx.send();
    if (ev === "create") socket.emit("create", { name: n, avatar: local.avatar });
    else { if (code.value.trim().length !== 4) return toast("Code hat 4 Buchstaben"); socket.emit("join", { code: code.value.trim(), name: n, avatar: local.avatar }); }
  };
  const hasCode = !!params.get("code");
  app.append(
    h("div", { class: "center" }, h("span", { class: "tag hot" }, "18+ · Schwarzer Humor"), h("h1", {}, "Lügenbaron"), h("p", { class: "muted" }, "Schreib die dreckigste Antwort. Lüg besser als das Haus. Entlarve deine Freunde.")),
    h("div", { class: "card" },
      h("label", {}, "Name"), name,
      h("label", {}, "Avatar"), avatarPicker(),
      h("div", { style: "height:16px" }),
      hasCode ? null : h("button", { class: "primary wide", onclick: () => go("create") }, "Neuen Raum erstellen"),
      hasCode ? null : h("div", { class: "or" }, "— oder einem Raum beitreten —"),
      h("div", { class: "row" }, code, h("button", { class: hasCode ? "primary" : "gold", onclick: () => go("join") }, "Beitreten")),
      hasCode ? h("p", { class: "center small muted" }, h("a", { href: "/", style: "color:var(--muted)" }, "Stattdessen eigenen Raum erstellen")) : null,
    ),
  );
  name.addEventListener("keydown", (e) => e.key === "Enter" && go(hasCode ? "join" : "create"));
  code.addEventListener("keydown", (e) => e.key === "Enter" && go("join"));
}

// ---------- Lobby ----------
function renderLobby() {
  const link = `${location.origin}/?code=${S.code}`;
  const host = isHost();
  const players = h("div", { class: "players" }, S.players.map((p) => h("div", { class: "player" + (p.connected ? "" : " off") },
    h("span", { class: "av" }, p.avatar),
    h("div", { style: "min-width:0" }, h("div", { class: "nm" }, p.name, p.id === S.me.id ? " (du)" : ""), p.isHost ? h("div", { class: "crown" }, "👑 Host") : null),
    host && p.id !== S.me.id ? h("button", { class: "kick", title: "Rauswerfen", onclick: () => socket.emit("kick", p.id) }, "✕") : null,
  )));

  const st = S.settings;
  const send = (patch) => socket.emit("settings", { ...st, ...patch });
  const roundsLbl = h("b", {}, st.rounds);
  const settings = h("div", { class: "card" }, h("h2", {}, "Einstellungen"), h("div", { class: "settings" },
    h("div", { class: "toggle" }, h("div", {}, "Runden: ", roundsLbl, h("div", { class: "small muted" }, `ca. ${Math.round(st.rounds * 2.2)} Minuten`)),
      h("input", { type: "range", min: 4, max: 15, value: st.rounds, disabled: !host, oninput: (e) => roundsLbl.textContent = e.target.value, onchange: (e) => send({ rounds: +e.target.value }) })),
    h("div", { class: "toggle" }, h("div", {}, "Zeichen-Runden", h("div", { class: "small muted" }, "Kritzeln statt schreiben")),
      h("input", { type: "checkbox", checked: st.draw, disabled: !host, onchange: (e) => send({ draw: e.target.checked }) })),
    h("div", { class: "toggle" }, h("div", {}, "Insider-Fragen vorab", h("div", { class: "small muted" }, "Jeder schreibt eigene Fragen über die Gruppe")),
      h("input", { type: "checkbox", checked: st.insider, disabled: !host, onchange: (e) => send({ insider: e.target.checked }) })),
  ), host ? null : h("p", { class: "small muted" }, "Nur der Host kann das ändern."));

  app.append(
    h("div", { class: "card center" },
      h("div", { class: "muted small" }, "RAUM-CODE"), h("div", { class: "code" }, S.code),
      h("button", { class: "gold", onclick: async () => { try { await navigator.clipboard.writeText(link); toast("Link kopiert – ab in den Discord damit!"); } catch { prompt("Link kopieren:", link); } } }, "🔗 Einladungslink kopieren"),
    ),
    h("div", { class: "card" }, h("h2", {}, `Spieler (${S.players.length})`), players,
      h("label", {}, "Dein Avatar"), avatarPicker((a) => socket.emit("avatar", a))),
    settings,
    h("div", { class: "card" }, h("h2", {}, "So geht's"), h("ul", { class: "rules" },
      h("li", {}, h("b", {}, "Antworten: "), "Schreib die lustigste Antwort. Jede Stimme = 100 Punkte."),
      h("li", {}, h("b", {}, "Das Haus lügt mit: "), "Eine Antwort ist vom Spiel. Wer sie wählt: −100."),
      h("li", {}, h("b", {}, "Wer war's? "), "Rate, wer was geschrieben hat: +50 pro Treffer."),
      h("li", {}, h("b", {}, "Wer würde am ehesten…? "), "Stimm mit der Mehrheit: +100."),
      h("li", {}, h("b", {}, "Finale: "), "Doppelte Punkte. Der Letzte kassiert eine Strafe."),
    )),
    host
      ? h("button", { class: "primary wide", disabled: S.players.filter((p) => p.connected).length < 3, onclick: () => socket.emit("start") }, S.players.length < 3 ? `Noch ${3 - S.players.length} Spieler nötig` : "Spiel starten 🔥")
      : h("p", { class: "center muted" }, "Warte, bis der Host startet…"),
  );
}

// ---------- Insider-Runde ----------
function renderInsider() {
  if (iAmDone()) return app.append(doneCard("Fragen eingereicht 😈"));
  const inputs = [0, 1, 2].map((i) => h("input", { placeholder: ["Was hat [Spieler] auf Malle gemacht?", "Warum hat [Spieler] Hausverbot?", "Optional: noch eine Frage"][i], maxlength: 150 }));
  app.append(h("div", { class: "card" },
    h("span", { class: "tag gold" }, "Insider-Runde"), h("h2", { style: "margin-top:10px" }, "Schreib bis zu 3 eigene Fragen"),
    h("p", { class: "muted small" }, "Tipp: [Spieler] wird automatisch durch einen zufälligen Namen ersetzt. Insider-Witze, alte Geschichten, alles erlaubt. Die Fragen kommen anonym im Spiel dran."),
    ...inputs.map((x) => h("div", { style: "margin-top:10px" }, x)),
    h("div", { style: "height:14px" }),
    h("button", { class: "primary wide", onclick: () => { sfx.send(); socket.emit("custom", inputs.map((i) => i.value)); } }, "Abschicken"),
    h("p", { class: "center small muted" }, "Zeit: ", h("span", { id: "secs" })),
  ), waitingStrip(), hostSkip());
}

// ---------- Antworten / Zeichnen ----------
function promptHeader(label) {
  return h("div", { class: "card" }, h("div", { class: "row", style: "align-items:center" },
    h("div", {}, h("span", { class: "tag " + (S.round.final ? "gold" : "hot") }, label)),
    h("div", { style: "text-align:right;flex:0", class: "muted", id: "secs" })), h("div", { class: "prompt" }, S.round.prompt));
}

function renderPrompt() {
  const draw = S.round.type === "draw";
  app.append(promptHeader(draw ? "Zeichnen" : "Antworten"));
  if (iAmDone()) return app.append(doneCard(draw ? "Kunstwerk abgegeben 🎨" : "Antwort abgeschickt 😏"));
  if (draw) return app.append(...drawPad());
  const ta = h("textarea", { placeholder: "Deine Antwort… je dreckiger, desto besser", maxlength: 120 });
  const cnt = h("div", { class: "counter" }, "0/120");
  ta.addEventListener("input", () => cnt.textContent = `${ta.value.length}/120`);
  const send = () => { if (!ta.value.trim()) return toast("Schreib erst was 😅"); sfx.send(); socket.emit("answer", { text: ta.value }); };
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  app.append(h("div", { class: "card" }, ta, cnt, h("div", { style: "height:10px" }), h("button", { class: "primary wide", onclick: send }, "Abschicken")), waitingStrip(), hostSkip());
  setTimeout(() => ta.focus(), 100);
}

function drawPad() {
  const SIZE = 600;
  const cv = h("canvas", { id: "pad", width: SIZE, height: SIZE });
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  let color = "#111", size = 6, drawing = false, last = null;
  const history = [];
  const snap = () => { history.push(ctx.getImageData(0, 0, SIZE, SIZE)); if (history.length > 25) history.shift(); };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * SIZE / r.width, y: (e.clientY - r.top) * SIZE / r.height }; };
  cv.addEventListener("pointerdown", (e) => { snap(); drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.fillStyle = color; ctx.arc(last.x, last.y, size / 2, 0, 7); ctx.fill(); });
  cv.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
  const stop = () => drawing = false;
  cv.addEventListener("pointerup", stop); cv.addEventListener("pointercancel", stop);

  const colors = ["#111", "#fff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#f48fb1", "#6d4c41"];
  const colBtns = colors.map((c) => h("button", { class: "col" + (c === color ? " sel" : ""), style: `background:${c};${c === "#fff" ? "box-shadow:inset 0 0 0 1px #999" : ""}`, onclick: (e) => { color = c; colBtns.forEach((b) => b.classList.remove("sel")); e.currentTarget.classList.add("sel"); } }));
  const sizes = [[3, "fein"], [6, "mittel"], [14, "dick"], [32, "fett"]];
  const szBtns = sizes.map(([s, l]) => h("button", { class: "sz" + (s === size ? " sel" : ""), onclick: (e) => { size = s; szBtns.forEach((b) => b.classList.remove("sel")); e.currentTarget.classList.add("sel"); } }, l));
  const send = () => { sfx.send(); socket.emit("answer", { drawing: cv.toDataURL("image/jpeg", .7) }); };
  return [h("div", { class: "card" }, cv,
    h("div", { class: "tools" }, colBtns), h("div", { class: "tools" }, szBtns,
      h("button", { class: "sz", onclick: () => { const d = history.pop(); if (d) ctx.putImageData(d, 0, 0); } }, "↩ Rückgängig"),
      h("button", { class: "sz", onclick: () => { snap(); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, SIZE, SIZE); } }, "🗑 Leeren")),
    h("button", { class: "primary wide", onclick: send }, "Kunstwerk abgeben")), waitingStrip(), hostSkip()];
}

// ---------- Abstimmen ----------
function entryContent(e) { return e.drawing ? h("img", { src: e.drawing, alt: "Zeichnung" }) : e.text; }

function renderVote() {
  const draw = S.round.type === "draw";
  app.append(h("div", { class: "card" }, h("div", { class: "row", style: "align-items:center" }, h("div", {}, h("span", { class: "tag hot" }, "Abstimmen")), h("div", { style: "flex:0", class: "muted", id: "secs" })),
    h("div", { class: "prompt", style: "font-size:20px" }, S.round.prompt),
    h("p", { class: "muted small" }, draw ? "Welches Kunstwerk ist das beste?" : "Was ist die lustigste Antwort? Vorsicht: eine davon ist vom Haus (−100).")));
  if (iAmDone()) return app.append(doneCard("Stimme abgegeben 🗳"));
  app.append(h("div", { class: "entries" + (draw ? " draw" : "") }, S.round.entries.map((e, i) =>
    h("button", { class: "entry" + (e.mine ? " mine" : ""), disabled: e.mine, style: `animation-delay:${i * 60}ms`, onclick: () => { sfx.send(); socket.emit("vote", e.id); } },
      entryContent(e), e.mine ? h("div", { class: "small muted", style: "margin-top:6px" }, "Deine") : null))), waitingStrip(), hostSkip());
}

// ---------- Wer war's? ----------
function renderGuess() {
  app.append(h("div", { class: "card" }, h("div", { class: "row", style: "align-items:center" }, h("div", {}, h("span", { class: "tag gold" }, "Wer war's?")), h("div", { style: "flex:0", class: "muted", id: "secs" })),
    h("p", { class: "muted" }, "Rate, wer was geschrieben hat. +50 pro Treffer." + (S.round.type === "answer" ? " Findest du die Haus-Antwort?" : ""))));
  if (iAmDone()) return app.append(doneCard("Tipps abgegeben 🕵️"));
  const choices = {};
  const opts = S.players.filter((p) => p.id !== S.me.id).map((p) => [p.id, `${p.avatar} ${p.name}`]);
  if (S.round.type === "answer") opts.push(["HOUSE", "🏠 Haus"]);
  const rows = S.round.entries.filter((e) => !e.mine).map((e) => {
    const chips = h("div", { class: "chips" }, opts.map(([id, label]) => h("button", { onclick: (ev) => {
      choices[e.id] = id; sfx.click(); chips.querySelectorAll("button").forEach((b) => b.classList.remove("sel")); ev.currentTarget.classList.add("sel");
    } }, label)));
    return h("div", { class: "guessRow" }, e.drawing ? h("img", { src: e.drawing }) : h("div", { class: "txt" }, e.text), chips);
  });
  app.append(h("div", { class: "entries" }, rows), h("div", { style: "height:12px" }),
    h("button", { class: "primary wide", onclick: () => { sfx.send(); socket.emit("guess", choices); } }, "Tipps abgeben"), waitingStrip(), hostSkip());
}

// ---------- Wer würde am ehesten ----------
function renderLikely() {
  app.append(promptHeader("Wer würde am ehesten…"));
  if (iAmDone()) return app.append(doneCard("Gewählt 👀"));
  app.append(h("p", { class: "muted center" }, "Stimm mit der Mehrheit, dann gibt's +100. Du darfst auch dich selbst wählen."),
    h("div", { class: "likelyGrid" }, S.round.options.map((p) => h("button", { onclick: () => { sfx.send(); socket.emit("likely", p.id); } },
      h("span", { class: "av" }, p.avatar), h("span", {}, p.name)))), waitingStrip(), hostSkip());
}

// ---------- Auflösung ----------
function deltaBadge(n) { return n ? h("span", { class: "delta " + (n > 0 ? "plus" : "minus") }, (n > 0 ? "+" : "") + n) : null; }

function scoreboard(delta = {}) {
  const sorted = [...S.players].sort((a, b) => b.score - a.score);
  return h("div", { class: "card" }, h("h2", {}, "Punktestand"), sorted.map((p, i) => h("div", { class: "score" + (p.connected ? "" : " off") },
    h("span", { class: "muted", style: "width:20px" }, i + 1 + "."), h("span", { class: "av" }, p.avatar), h("span", { class: "nm" }, p.name, p.id === S.me.id ? " (du)" : ""),
    deltaBadge(delta[p.id]), h("span", { class: "pts" }, p.score))));
}

function renderReveal() {
  const r = S.round.result;
  app.append(h("div", { class: "card" }, h("span", { class: "tag " + (S.round.final ? "gold" : "hot") }, "Auflösung"), h("div", { class: "prompt", style: "font-size:20px" }, S.round.prompt),
    r.customBy ? h("p", { class: "small muted" }, `Insider-Frage von ${r.customBy}`) : null));

  if (r.kind === "likely") {
    const order = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
    app.append(h("div", { class: "card center" },
      r.winners.length ? h("div", {}, h("div", { style: "font-size:64px", class: "podium" }, h("span", { class: "av" }, r.winners.map((w) => player(w)?.avatar).join(" "))),
        h("h2", {}, r.winners.map((w) => player(w)?.name).join(" & "), r.winners.length > 1 ? " – unentschieden!" : ""),
        h("p", { class: "muted" }, "Die Gruppe hat entschieden. Kein Widerspruch möglich.")) : h("p", {}, "Keiner hat abgestimmt 🤷"),
    ), h("div", { class: "card" }, h("h2", {}, "Wer hat wen gewählt"), Object.entries(r.votes).map(([v, t], i) =>
      h("div", { class: "score", style: `animation:slideIn .4s ${i * 120}ms backwards` }, h("span", { class: "nm" }, pname(v)), h("span", { class: "muted" }, "→"), h("span", { class: "nm", style: "text-align:right" }, pname(t)))),
    ));
  } else {
    app.append(h("div", {}, r.entries.map((e, i) => {
      const house = e.author === "HOUSE";
      return h("div", { class: "res" + (house ? " house" : i === 0 && e.voters.length ? " top" : ""), style: `animation-delay:${i * 450}ms` },
        e.drawing ? h("img", { src: e.drawing }) : h("div", { class: "txt" }, e.text),
        h("div", { class: "meta" }, house ? h("span", { class: "tag", style: "background:var(--bad);color:#fff" }, "Haus-Antwort") : h("span", {}, "von ", h("span", { class: "author" }, pname(e.author))),
          h("span", { class: "votes" }, `${e.voters.length} ${e.voters.length === 1 ? "Stimme" : "Stimmen"}`)),
        e.voters.length ? h("div", { class: "meta" }, (house ? "Reingefallen: " : "Gewählt von: ") + e.voters.map(pname).join(", ")) : null,
        e.guessedBy.length ? h("div", { class: "meta" }, "🕵️ Richtig erkannt: " + e.guessedBy.map(pname).join(", ")) : null,
      );
    })));
  }
  app.append(scoreboard(r.delta));
  const last = S.roundNo >= S.roundCount;
  app.append(isHost()
    ? h("button", { class: "primary wide", onclick: () => socket.emit("next") }, last ? "Zur Siegerehrung 🏆" : "Nächste Runde →")
    : h("p", { class: "center muted" }, "Der Host geht gleich weiter… (", h("span", { id: "secs" }), ")"));
}

// ---------- Finale ----------
function renderFinal() {
  const f = S.final, [a, b, c] = f.ranking;
  const step = (p, cls, place) => p ? h("div", { class: "step " + cls }, h("div", { class: "av" }, p.avatar), h("div", { class: "nm" }, p.name), h("div", { class: "bar" }, place, h("div", { style: "font-size:14px" }, p.score))) : h("div", { class: "step" });
  app.append(
    h("div", { class: "center" }, h("span", { class: "tag gold" }, "Siegerehrung"), h("h1", {}, `${a.avatar} ${a.name} gewinnt!`)),
    h("div", { class: "card" }, h("div", { class: "podium" }, step(b, "p2", "2"), step(a, "p1", "1"), step(c, "p3", "3"))),
    f.titles.length ? h("div", { class: "card" }, h("h2", {}, "Ehrentitel"), f.titles.map((t) => h("div", { class: "title" }, h("span", { style: "font-size:28px" }, player(t.id)?.avatar || "❓"),
      h("div", {}, h("b", {}, `${t.title}: ${player(t.id)?.name || "?"}`), h("span", { class: "small muted" }, t.desc))))) : null,
    f.loser ? h("div", { class: "card penalty center" }, h("span", { class: "tag hot" }, "Strafe für den Letzten"), h("h2", { style: "margin-top:10px" }, `${pname(f.loser.id)}…`), h("div", { class: "big" }, f.loser.penalty)) : null,
    h("div", { class: "card" }, h("h2", {}, "Endstand"), f.ranking.map((p, i) => h("div", { class: "score" }, h("span", { class: "muted", style: "width:20px" }, i + 1 + "."), h("span", { class: "av" }, p.avatar), h("span", { class: "nm" }, p.name), h("span", { class: "pts" }, p.score)))),
    isHost() ? h("button", { class: "primary wide", onclick: () => socket.emit("lobby") }, "Nochmal spielen 🔁") : h("p", { class: "center muted" }, "Der Host kann eine neue Runde starten."),
  );
}
})();
