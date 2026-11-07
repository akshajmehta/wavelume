/* Wavelume flip clock — countdown, Pomodoro and stopwatch.
   Self-contained: adds its own button, panel, styles and the centred split-flap clock. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const LS = "wavelume_timer_v1";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (_) { return {}; } })();
  const cfg = Object.assign({ mode: "countdown", cdMin: 25, cdSec: 0, focus: 25, short: 5, long: 15, every: 4,
    size: "m", theme: "glass", chime: true, autoNext: true }, saved.cfg || {});
  if (!["black", "white", "glass"].includes(cfg.theme)) cfg.theme = "glass";
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ cfg })); } catch (_) {} };

  /* ───────── styles ───────── */
  const css = `
  #flipclock{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;display:none;flex-direction:column;align-items:center;gap:calc(var(--h)*.16);pointer-events:none;--h:min(28vh,21vw);--w:calc(var(--h)*.68);--r:calc(var(--h)*.1)}
  #flipclock.on{display:flex}
  #flipclock.s{--h:min(17vh,14vw)}#flipclock.l{--h:min(42vh,29vw)}
  #flipclock.hms{--h:min(28vh,15vw)}#flipclock.hms.s{--h:min(17vh,11vw)}#flipclock.hms.l{--h:min(42vh,19.5vw)}
  #fcLabel{font:600 calc(var(--h)*.13)/1 "Segoe UI",system-ui,-apple-system,sans-serif;letter-spacing:.42em;text-transform:uppercase;color:rgba(255,255,255,.82);text-shadow:0 2px 12px rgba(0,0,0,.7);padding-left:.42em}
  #fcDigits{display:flex;align-items:center;gap:calc(var(--h)*.07)}
  .fcGroup{display:flex;gap:calc(var(--h)*.05)}
  .fcSep{display:flex;flex-direction:column;gap:calc(var(--h)*.2);padding:0 calc(var(--h)*.04)}
  .fcSep i{display:block;width:calc(var(--h)*.075);height:calc(var(--h)*.075);border-radius:50%;background:rgba(240,244,255,.85);box-shadow:0 0 calc(var(--h)*.1) rgba(0,0,0,.6)}
  /* themes: black (solid charcoal), white (paper), glass (frosted, iOS-style) */
  #flipclock{--fg:#eef1f7;--ct:linear-gradient(180deg,#2a2c34,#1b1c22);--cb:linear-gradient(180deg,#17181d,#22242b);--hinge:rgba(0,0,0,.7);--shadow:0 calc(var(--h)*.05) calc(var(--h)*.12) rgba(0,0,0,.55);--edge:none;--txs:none}
  #flipclock.white{--fg:#16181d;--ct:linear-gradient(180deg,#ffffff,#eef0f3);--cb:linear-gradient(180deg,#e7e9ed,#f7f8fa);--hinge:rgba(0,0,0,.16);--shadow:0 calc(var(--h)*.05) calc(var(--h)*.14) rgba(0,0,0,.45)}
  #flipclock.glass{--fg:#fff;--ct:linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.05));--cb:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.08));--hinge:rgba(255,255,255,.22);--shadow:0 calc(var(--h)*.03) calc(var(--h)*.12) rgba(0,0,0,.18);--edge:1px solid rgba(255,255,255,.3);--txs:0 calc(var(--h)*.02) calc(var(--h)*.07) rgba(0,0,0,.5)}
  .fd{position:relative;width:var(--w);height:var(--h);perspective:calc(var(--h)*5);font:700 calc(var(--h)*.74)/1 "Segoe UI","Helvetica Neue",system-ui,-apple-system,sans-serif;color:var(--fg);font-variant-numeric:tabular-nums;border-radius:var(--r);box-shadow:var(--shadow);text-shadow:var(--txs)}
  .fd>div{position:absolute;left:0;right:0;height:50%;overflow:hidden;background:var(--ct);backface-visibility:hidden;-webkit-backface-visibility:hidden}
  #flipclock.glass .fd>div{-webkit-backdrop-filter:blur(calc(var(--h)*.05)) saturate(160%);backdrop-filter:blur(calc(var(--h)*.05)) saturate(160%);border:var(--edge)}
  #flipclock.glass .fd .t,#flipclock.glass .fd .ft{border-bottom:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.45)}
  #flipclock.glass .fd .b,#flipclock.glass .fd .fb{border-top:0}
  #flipclock.glass .fd .ft,#flipclock.glass .fd .fb{background:linear-gradient(180deg,rgba(40,44,56,.42),rgba(40,44,56,.3))}
  .fd span{display:block;height:var(--h);line-height:var(--h);text-align:center}
  .fd .t,.fd .ft{top:0;border-radius:var(--r) var(--r) 0 0}
  .fd .b,.fd .fb{bottom:0;border-radius:0 0 var(--r) var(--r);background:var(--cb)}
  .fd .b span,.fd .fb span{margin-top:calc(var(--h)/-2)}
  .fd .ft{transform-origin:50% 100%;z-index:3}
  .fd .fb{transform-origin:50% 0;transform:rotateX(90deg);z-index:3}
  .fd.flip .ft{animation:fcTop .26s ease-in forwards}
  .fd.flip .fb{animation:fcBot .26s .26s ease-out forwards}
  .fd.flip .ft:after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.35);animation:fcShade .26s ease-in forwards}
  .fd:after{content:"";position:absolute;left:0;right:0;top:calc(50% - 1px);height:2px;background:var(--hinge);z-index:5}
  @keyframes fcTop{to{transform:rotateX(-90deg)}}@keyframes fcBot{from{transform:rotateX(90deg)}to{transform:rotateX(0)}}
  @keyframes fcShade{from{opacity:0}to{opacity:1}}
  #fcBar{width:100%;height:calc(var(--h)*.025);min-height:2px;border-radius:9px;background:rgba(255,255,255,.14);overflow:hidden}
  #fcBar>i{display:block;height:100%;width:0;background:rgba(255,255,255,.75);transition:width .5s linear}
  #fcDots{display:flex;gap:calc(var(--h)*.07)}#fcDots i{width:calc(var(--h)*.06);height:calc(var(--h)*.06);border-radius:50%;background:rgba(255,255,255,.25)}#fcDots i.on{background:rgba(255,255,255,.85)}
  #flipclock.done .fd{animation:fcPulse 1s ease-in-out infinite}
  @keyframes fcPulse{50%{opacity:.35}}
  #flipclock.paused .fd span{opacity:.5}
  /* panel */
  #tpanel{position:fixed;right:calc(12px + env(safe-area-inset-right));bottom:calc(140px + env(safe-area-inset-bottom));z-index:9;width:min(380px,calc(100vw - 24px));background:var(--glass,rgba(12,14,18,.82));border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:none;color:#e8ecf2;font:14px/1.3 "Segoe UI",system-ui,-apple-system,sans-serif}
  #tpanel.open{display:block}
  body.hideui #tpanel,body.locked #tpanel{display:none}
  #tpanel .tabs{display:flex;background:rgba(255,255,255,.06);border-radius:10px;padding:3px;margin-bottom:12px}
  #tpanel .tabs button{flex:1;border:0;background:none;color:#9aa3b2;padding:7px 0;border-radius:8px;font:inherit;font-size:13px;cursor:pointer}
  #tpanel .tabs button.on{background:rgba(79,195,255,.22);color:#fff}
  #tpanel .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}
  #tpanel .chip{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#e8ecf2;border-radius:999px;padding:5px 11px;font:inherit;font-size:13px;cursor:pointer}
  #tpanel .chip:hover{background:rgba(255,255,255,.12)}
  #tpanel label{font-size:12px;color:#9aa3b2;display:flex;align-items:center;gap:6px}
  #tpanel input[type=number]{width:56px;padding:6px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-size:14px;text-align:center}
  #tpanel .actions{display:flex;gap:8px;margin-top:12px}
  #tpanel .actions button{flex:1;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;cursor:pointer}
  #tpanel .actions .go{background:linear-gradient(#2b8fd6,#14588f);border-color:rgba(255,255,255,.25)}
  #tpanel .sub{font-size:12px;color:#9aa3b2;margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
  #tpanel .sizes button{border:1px solid rgba(255,255,255,.16);background:none;color:#cfd6e0;border-radius:7px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}
  #tpanel .sizes button.on{background:rgba(255,255,255,.16);color:#fff}
  #tpanel [data-pane]{display:none}#tpanel[data-mode=countdown] [data-pane=countdown],#tpanel[data-mode=pomodoro] [data-pane=pomodoro],#tpanel[data-mode=stopwatch] [data-pane=stopwatch]{display:block}
  body.timeron #start{display:none!important}
  body.timeron #timerbtn{color:#4fc3ff;background:rgba(79,195,255,.15)}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ───────── markup ───────── */
  const clock = document.createElement("div");
  clock.id = "flipclock";
  clock.innerHTML = '<div id="fcLabel"></div><div id="fcDigits"></div><div id="fcBar"><i></i></div><div id="fcDots"></div>';
  document.body.appendChild(clock);

  const panel = document.createElement("div");
  panel.id = "tpanel";
  panel.innerHTML = `
    <div class="tabs"><button data-m="countdown">Countdown</button><button data-m="pomodoro">Pomodoro</button><button data-m="stopwatch">Stopwatch</button></div>
    <div data-pane="countdown">
      <div class="row">${[5, 10, 15, 25, 45, 60, 90].map((m) => `<button class="chip" data-min="${m}">${m}m</button>`).join("")}</div>
      <div class="row"><label>Minutes <input type="number" id="tcMin" min="0" max="999"></label><label>Seconds <input type="number" id="tcSec" min="0" max="59"></label></div>
    </div>
    <div data-pane="pomodoro">
      <div class="row"><label>Focus <input type="number" id="tpF" min="1" max="180"></label><label>Break <input type="number" id="tpS" min="1" max="60"></label><label>Long <input type="number" id="tpL" min="1" max="90"></label></div>
      <div class="row"><label>Long break every <input type="number" id="tpE" min="2" max="12"> rounds</label></div>
    </div>
    <div data-pane="stopwatch"><div class="row" style="color:#9aa3b2;font-size:13px">Counts up from zero. Great for live study streams.</div></div>
    <div class="actions"><button class="go" id="tGo">Start</button><button id="tReset">Reset</button><button id="tHide">Hide clock</button></div>
    <div class="sub"><span class="sizes">Style <button data-th="black">Black</button> <button data-th="white">White</button> <button data-th="glass">Glass</button></span></div>
    <div class="sub"><span class="sizes">Size <button data-s="s">S</button> <button data-s="m">M</button> <button data-s="l">L</button></span>
      <label><input type="checkbox" id="tChime"> Chime</label><label id="tAutoL"><input type="checkbox" id="tAuto"> Auto-start next</label></div>`;
  document.body.appendChild(panel);

  const btn = document.createElement("button");
  btn.className = "btn"; btn.id = "timerbtn"; btn.title = "Timer / Pomodoro / Stopwatch (T)";
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61zM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"/></svg>';
  const fsBtn = $("fs"); fsBtn.parentNode.insertBefore(btn, fsBtn);

  /* ───────── flip digits ───────── */
  let digits = [], layout = "";
  function build(fmt) {           // fmt: "mmss" or "hhmmss"
    if (layout === fmt) return; layout = fmt;
    const groups = fmt === "hhmmss" ? 3 : 2, box = $("fcDigits"); box.innerHTML = ""; digits = [];
    for (let g = 0; g < groups; g++) {
      if (g) { const s = document.createElement("div"); s.className = "fcSep"; s.innerHTML = "<i></i><i></i>"; box.appendChild(s); }
      const grp = document.createElement("div"); grp.className = "fcGroup";
      for (let k = 0; k < 2; k++) {
        const d = document.createElement("div"); d.className = "fd";
        d.innerHTML = '<div class="t"><span>0</span></div><div class="b"><span>0</span></div><div class="ft"><span>0</span></div><div class="fb"><span>0</span></div>';
        grp.appendChild(d); digits.push({ el: d, v: "0", t: 0 });
      }
      box.appendChild(grp);
    }
  }
  function setDigit(d, v, animate) {
    if (d.v === v) return;
    const old = d.v, q = (s) => d.el.querySelector(s + " span");
    d.v = v;
    if (!animate) { ["t", "b", "ft", "fb"].forEach((c) => (q("." + c).textContent = v)); return; }
    q(".t").textContent = v; q(".b").textContent = old; q(".ft").textContent = old; q(".fb").textContent = v;
    d.el.classList.remove("flip"); void d.el.offsetWidth; d.el.classList.add("flip");
    clearTimeout(d.t); d.t = setTimeout(() => { q(".b").textContent = v; q(".ft").textContent = v; d.el.classList.remove("flip"); }, 560);
  }
  function show(totalSec, animate = true) {
    totalSec = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    const fmt = h > 0 || (state.mode !== "stopwatch" && planned() >= 3600) ? "hhmmss" : "mmss";
    const fresh = layout !== fmt; build(fmt);
    const str = (fmt === "hhmmss" ? String(Math.min(h, 99)).padStart(2, "0") : "") + String(fmt === "hhmmss" ? m : Math.min(h * 60 + m, 99)).padStart(2, "0") + String(s).padStart(2, "0");
    [...str].forEach((c, i) => setDigit(digits[i], c, animate && !fresh));
  }

  /* ───────── timer state ───────── */
  const state = { mode: cfg.mode, running: false, endAt: 0, left: 0, swStart: 0, swAcc: 0, phase: "focus", round: 1, shown: false, done: false };
  const phaseMin = () => state.phase === "focus" ? cfg.focus : state.phase === "short" ? cfg.short : cfg.long;
  const planned = () => state.mode === "countdown" ? cfg.cdMin * 60 + cfg.cdSec : state.mode === "pomodoro" ? phaseMin() * 60 : 0;

  function label() {
    if (state.done) return "Time's up";
    if (state.mode === "stopwatch") return "Stopwatch";
    if (state.mode === "countdown") return "Countdown";
    return state.phase === "focus" ? `Focus · ${state.round}/${cfg.every}` : state.phase === "short" ? "Short break" : "Long break";
  }
  function current() {
    if (state.mode === "stopwatch") return (state.swAcc + (state.running ? Date.now() - state.swStart : 0)) / 1000;
    const ms = state.running ? state.endAt - Date.now() : state.left;
    return Math.ceil(Math.max(0, ms) / 1000);
  }
  function render(animate = true) {
    $("fcLabel").textContent = label();
    show(current(), animate);
    const bar = $("fcBar"), p = planned();
    bar.style.display = state.mode === "stopwatch" ? "none" : "";
    if (p) bar.firstChild.style.width = (100 * (1 - current() / p)).toFixed(2) + "%";
    const dots = $("fcDots");
    if (state.mode === "pomodoro") { dots.style.display = ""; dots.innerHTML = Array.from({ length: cfg.every }, (_, i) => `<i class="${i < state.round - (state.phase === "focus" ? 1 : 0) ? "on" : ""}"></i>`).join(""); }
    else dots.style.display = "none";
    clock.className = ["on", cfg.size === "m" ? "" : cfg.size, cfg.theme, layout === "hhmmss" ? "hms" : "", state.done ? "done" : "", !state.running && !state.done ? "paused" : ""].filter(Boolean).join(" ");
    if (!state.shown) clock.classList.remove("on");
    document.body.classList.toggle("timeron", state.shown);
    $("tGo").textContent = state.running ? "Pause" : (current() > 0 && current() < planned()) || (state.mode === "stopwatch" && state.swAcc > 0) ? "Resume" : "Start";
  }

  function resetTimer() {
    state.running = false; state.done = false; state.swAcc = 0;
    if (state.mode === "pomodoro" && state.phase !== "focus") { /* keep phase on reset of a break */ }
    state.left = planned() * 1000; render(false);
  }
  function start() {
    unlockAudio();
    if (state.done) { state.done = false; state.left = planned() * 1000; }
    if (state.mode === "stopwatch") { state.swStart = Date.now(); }
    else { if (state.left <= 0) state.left = planned() * 1000; state.endAt = Date.now() + state.left; }
    state.running = true; state.shown = true; render(false);
  }
  function pause() {
    if (!state.running) return;
    if (state.mode === "stopwatch") state.swAcc += Date.now() - state.swStart;
    else state.left = Math.max(0, state.endAt - Date.now());
    state.running = false; render(false);
  }
  function finish() {
    state.running = false; state.left = 0; chime();
    if (state.mode === "pomodoro") {
      if (state.phase === "focus") { state.phase = state.round % cfg.every === 0 ? "long" : "short"; }
      else { state.round = state.phase === "long" ? 1 : state.round + 1; state.phase = "focus"; }
      state.left = planned() * 1000;
      toastMsg(state.phase === "focus" ? "Break's over — back to focus" : "Focus block done — take a break");
      if (cfg.autoNext) { start(); return; }
      render(false); return;
    }
    state.done = true; render(false);
    setTimeout(() => { if (state.done) { state.done = false; render(false); } }, 8000);
  }
  function toastMsg(t) { if (window.VIZ && VIZ.toast) VIZ.toast(t, ""); }

  // tick (timestamps, so it stays accurate when the tab is in the background)
  let lastShown = -1;
  setInterval(() => {
    if (!state.shown) return;
    if (state.running && state.mode !== "stopwatch" && state.endAt - Date.now() <= 0) { finish(); return; }
    const c = Math.floor(current());
    if (c !== lastShown) { lastShown = c; render(true); }
  }, 100);

  /* ───────── chime (soft bell, not fed into the visualizer) ───────── */
  let actx = null;
  function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== "running") actx.resume(); } catch (_) {} }
  function chime() {
    if (!cfg.chime || !actx) return;
    const t0 = actx.currentTime;
    [[880, 0], [1318.5, 0.18], [1760, 0.36]].forEach(([f, d]) => {
      [1, 2.76].forEach((mult, k) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = f * mult;
        g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(k ? 0.04 : 0.18, t0 + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 1.6);
        o.connect(g); g.connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 1.7);
      });
    });
  }

  /* ───────── panel wiring ───────── */
  const num = (id, key, lo, hi) => { const el = $(id); el.value = cfg[key];
    el.addEventListener("change", () => { const v = Math.max(lo, Math.min(hi, parseInt(el.value || "0", 10) || 0)); el.value = v; cfg[key] = v; save(); if (!state.running) resetTimer(); }); };
  num("tcMin", "cdMin", 0, 999); num("tcSec", "cdSec", 0, 59); num("tpF", "focus", 1, 180); num("tpS", "short", 1, 60); num("tpL", "long", 1, 90); num("tpE", "every", 2, 12);
  $("tChime").checked = cfg.chime; $("tChime").onchange = (e) => { cfg.chime = e.target.checked; save(); };
  $("tAuto").checked = cfg.autoNext; $("tAuto").onchange = (e) => { cfg.autoNext = e.target.checked; save(); };

  function setMode(m) {
    pause(); cfg.mode = state.mode = m; save(); panel.dataset.mode = m;
    panel.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    $("tAutoL").style.display = m === "pomodoro" ? "" : "none";
    if (m === "pomodoro") { state.phase = "focus"; state.round = 1; }
    resetTimer();
  }
  panel.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  panel.querySelectorAll("[data-min]").forEach((b) => (b.onclick = () => { cfg.cdMin = +b.dataset.min; cfg.cdSec = 0; $("tcMin").value = cfg.cdMin; $("tcSec").value = 0; save(); pause(); resetTimer(); start(); }));
  const setSize = (s) => { cfg.size = s; save(); panel.querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === s)); render(false); };
  panel.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => setSize(b.dataset.s)));
  const setTheme = (t) => { cfg.theme = t; save(); panel.querySelectorAll("[data-th]").forEach((b) => b.classList.toggle("on", b.dataset.th === t)); render(false); };
  panel.querySelectorAll("[data-th]").forEach((b) => (b.onclick = () => setTheme(b.dataset.th)));
  $("tGo").onclick = () => (state.running ? pause() : start());
  $("tReset").onclick = () => { if (state.mode === "pomodoro") { state.phase = "focus"; state.round = 1; } resetTimer(); };
  $("tHide").onclick = () => { state.shown = !state.shown; render(false); };
  const togglePanel = () => {
    ["pl", "srcmenu"].forEach((id) => $(id) && $(id).classList.remove("open"));
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !state.shown) { state.shown = true; render(false); }
  };
  btn.onclick = (e) => { e.stopPropagation(); togglePanel(); };
  addEventListener("keydown", (e) => {
    if ((e.key === "t" || e.key === "T") && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "range")) togglePanel();
  });
  addEventListener("pointerdown", (e) => { if (!e.target.closest("#tpanel,#timerbtn")) panel.classList.remove("open"); });
  // keep the hide-clock button label in sync
  new MutationObserver(() => ($("tHide").textContent = state.shown ? "Hide clock" : "Show clock")).observe(clock, { attributes: true });

  setMode(cfg.mode); setSize(cfg.size); setTheme(cfg.theme);
  window.WLTimer = { state, cfg, start, pause, reset: resetTimer, setMode, finish };
})();
