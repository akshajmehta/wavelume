// Accounts, the daily free allowance, the paywall, and app install — layered on top of the visualizer.
import { createBackend } from "./backend.js";

const cfg = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);
const VIZ = window.VIZ;
const isStandalone = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const isMacSafari = !isIOS && /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent);

/* ───────── branding ───────── */
document.title = `${cfg.name} — Music Visualizer`;
document.querySelectorAll("[data-brand]").forEach((el) => (el.textContent = cfg.name));
const brand = $("brand"); if (brand) brand.textContent = cfg.name;

/* ───────── state ───────── */
let be = null, me = null, st = null;          // backend, user, server status
let remaining = 0, pending = 0, lastFlush = 0, flushing = false;
let priceLabel = cfg.priceLabel || "";
const LS = "wavelume_local_v1";
const localGet = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (_) { return {}; } };
const localSet = (o) => { try { localStorage.setItem(LS, JSON.stringify({ ...localGet(), ...o })); } catch (_) {} };
const day = () => new Date().toISOString().slice(0, 10);

/* ───────── gate wired into the visualizer ───────── */
VIZ.canPlay = () => !!me && !!st && (st.lifetime || remaining > 0);
VIZ.onBlocked = () => { if (!me) showAuth("signin"); else if (st) showPaywall(); };

/* ───────── in-page dialog (alert/confirm are blocked in some app frames) ───────── */
function confirmDialog(title, text, okLabel = "OK", cancelLabel = "Cancel") {
  return new Promise((res) => {
    $("dlgTitle").textContent = title; $("dlgText").textContent = text;
    $("dlgOk").textContent = okLabel; $("dlgCancel").textContent = cancelLabel;
    $("dlgCancel").style.display = cancelLabel ? "" : "none";
    $("dlg").classList.add("open");
    const done = (v) => { $("dlg").classList.remove("open"); $("dlgOk").onclick = $("dlgCancel").onclick = null; res(v); };
    $("dlgOk").onclick = () => done(true); $("dlgCancel").onclick = () => done(false);
  });
}

/* ───────── auth screens ───────── */
function showAuth(view) {
  document.body.classList.add("locked");
  $("auth").classList.add("open"); $("paywall").classList.remove("open");
  setView(view || "signin");
}
function hideAuth() { $("auth").classList.remove("open"); document.body.classList.remove("locked"); }
function setView(v) {
  $("auth").dataset.view = v;
  $("authTitle").textContent = { signin: "Sign in", signup: "Create your free account", reset: "Reset password", newpw: "Choose a new password" }[v];
  $("authSubmit").textContent = { signin: "Sign in", signup: "Create account", reset: "Send reset link", newpw: "Save password" }[v];
  $("authMsg").textContent = ""; $("authMsg").className = "msg";
  $("authPw").autocomplete = v === "signin" ? "current-password" : "new-password";
}
function authMsg(text, ok) { $("authMsg").textContent = text; $("authMsg").className = "msg" + (ok ? " ok" : " err"); }
const niceErr = (e) => {
  const m = (e && e.message) || String(e);
  if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox.";
  if (/already registered/i.test(m)) return "An account with this email already exists. Sign in instead.";
  if (/Password should be/i.test(m)) return "Password must be at least 6 characters.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Can't reach the server. Check your internet connection.";
  return m;
};

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("auth").dataset.view, email = $("authEmail").value.trim(), pw = $("authPw").value;
  if (v !== "newpw" && !/^\S+@\S+\.\S+$/.test(email)) return authMsg("Enter a valid email address.");
  if ((v === "signin" || v === "signup" || v === "newpw") && pw.length < 6) return authMsg("Password must be at least 6 characters.");
  $("authSubmit").disabled = true;
  try {
    if (v === "signin") await be.signIn(email, pw);
    else if (v === "signup") { const r = await be.signUp(email, pw); if (r.needsConfirm) { setView("signin"); authMsg("Almost there — open the confirmation link we just emailed you, then sign in here.", true); } }
    else if (v === "reset") { await be.resetPassword(email); authMsg("If that email has an account, a reset link is on its way.", true); }
    else if (v === "newpw") { await be.setNewPassword(pw); authMsg("Password updated.", true); await afterSignIn(await be.session()); }
  } catch (err) { authMsg(niceErr(err)); }
  finally { $("authSubmit").disabled = false; }
});
document.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); setView(a.dataset.goto); }));
$("googleBtn").onclick = async () => { try { await be.google(); } catch (e) { authMsg(niceErr(e)); } };
if (!cfg.googleSignIn) $("googleRow").style.display = "none";

/* ───────── status + free-time accounting ───────── */
function applyStatus(s) {
  st = s;
  remaining = s.lifetime ? Infinity : Math.max(0, s.limit - s.used - pending);
  localSet({ day: day(), user: me && me.id, used: s.used, limit: s.limit, lifetime: s.lifetime });
  renderPill(); renderAccount();
  if (!s.lifetime && remaining <= 0) lockNow();
}
async function refreshStatus() {
  try { applyStatus(await be.status()); }
  catch (e) {
    // offline fallback: last known numbers for today (never resets the counter)
    const l = localGet();
    if (l.user === (me && me.id) && l.day === day()) applyStatus({ lifetime: l.lifetime, used: l.used, limit: l.limit, resetsAt: nextMidnight() });
    else applyStatus({ lifetime: !!(l.user === (me && me.id) && l.lifetime), used: 0, limit: cfg.freeSecondsPerDay || 240, resetsAt: nextMidnight() });
  }
}
const nextMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d; };
async function flush(force) {
  if (flushing || !me || !st || st.lifetime) return;
  if (!pending && !force) return;
  flushing = true; const send = Math.min(pending, 30);
  try { const s = await be.useTime(send); pending -= send; applyStatus(s); lastFlush = Date.now(); }
  catch (e) { const l = localGet(); localSet({ used: (l.used | 0) + send }); pending -= send; } // offline: keep counting locally
  finally { flushing = false; }
}
setInterval(() => {
  if (!me || !st || st.lifetime) return;
  if (VIZ.isActive() && !document.hidden) {
    pending++; remaining = Math.max(0, remaining - 1); renderPill();
    if (remaining <= 0) { lockNow(); flush(true); return; }
  }
  if (pending >= 15 || (pending && Date.now() - lastFlush > 15000)) flush();
}, 1000);
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); else if (me) refreshStatus(); });

function fmt(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function renderPill() {
  const p = $("freePill");
  if (!me || !st || st.lifetime) { p.style.display = "none"; return; }
  p.style.display = ""; p.textContent = remaining > 0 ? `Free · ${fmt(remaining)} left today` : "Free time used up";
  p.classList.toggle("low", remaining <= 30);
}

/* ───────── paywall ───────── */
function lockNow() { VIZ.stopAll(); showPaywall(); }
function showPaywall() {
  if (!st || st.lifetime) return;
  const ms = (st.resetsAt || nextMidnight()) - Date.now(), h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  $("pwReset").textContent = `Your free minutes come back in ${h}h ${m}m.`;
  $("pwBuy").textContent = `Unlock forever · ${priceLabel}`;
  $("pwMsg").textContent = ""; $("pwMsg").className = "msg";
  $("paywall").classList.add("open"); document.body.classList.add("locked");
}
function hidePaywall() { $("paywall").classList.remove("open"); document.body.classList.remove("locked"); }
async function buy() {
  $("pwBuy").disabled = true; $("pwMsg").textContent = ""; $("pwMsg").className = "msg";
  try {
    const ok = await be.checkout({ confirm: confirmDialog });
    if (ok) { await refreshStatus(); if (st.lifetime) { hidePaywall(); $("acctMenu").classList.remove("open"); VIZ.toast(`Welcome to ${cfg.name} — unlocked forever`, "Thank you for supporting it!"); } else { $("pwMsg").textContent = "Payment received — unlocking can take a minute. Tap “Restore purchase” shortly."; $("pwMsg").className = "msg ok"; } }
  } catch (e) { $("pwMsg").textContent = niceErr(e); $("pwMsg").className = "msg err"; }
  finally { $("pwBuy").disabled = false; }
}
$("pwBuy").onclick = buy; $("acctBuy").onclick = () => { $("acctMenu").classList.remove("open"); st && !st.lifetime && (showPaywall(), buy()); };
$("pwRestore").onclick = $("acctRestore").onclick = async () => { await refreshStatus(); if (st.lifetime) { hidePaywall(); VIZ.toast("Purchase restored", "Unlimited visuals unlocked"); } else { $("pwMsg").textContent = "No purchase found on this account yet."; $("pwMsg").className = "msg err"; VIZ.toast("No purchase found on this account", ""); } };
$("pwSignOut").onclick = $("acctSignOut").onclick = async () => { $("acctMenu").classList.remove("open"); await flush(true); await be.signOut(); };
$("pwClose").onclick = () => hidePaywall(); // free users can still look around, but nothing plays

/* ───────── account menu ───────── */
$("acctDelete").onclick = async () => {
  $("acctMenu").classList.remove("open");
  const paid = st && st.lifetime;
  const ok = await confirmDialog("Delete your account?",
    "This permanently deletes your account and usage history." + (paid ? " Your lifetime unlock will be lost and cannot be restored." : "") + " This can't be undone.",
    "Delete forever", "Keep account");
  if (!ok) return;
  try { VIZ.stopAll(); await be.deleteAccount(); VIZ.toast("Your account has been deleted", ""); }
  catch (e) { confirmDialog("Couldn't delete the account", niceErr(e) + (cfg.supportEmail ? " You can also email " + cfg.supportEmail + "." : ""), "OK", ""); }
};
function renderAccount() {
  $("acct").style.display = me ? "" : "none";
  if (!me) return;
  $("acctAvatar").textContent = (me.email || "?")[0].toUpperCase();
  $("acctEmail").textContent = me.email;
  $("acctPlan").textContent = st && st.lifetime ? "Lifetime — unlimited" : `Free — ${Math.round((st ? st.limit : 240) / 60)} min per day`;
  $("acctBuy").style.display = st && !st.lifetime ? "" : "none";
  $("acctBuy").textContent = `Unlock forever · ${priceLabel}`;
}
$("acctAvatar").onclick = (e) => { e.stopPropagation(); $("acctMenu").classList.toggle("open"); };
addEventListener("pointerdown", (e) => { if (!e.target.closest("#acct")) $("acctMenu").classList.remove("open"); });

/* ───────── install (PWA) ───────── */
let deferredPrompt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; renderInstall(); });
addEventListener("appinstalled", () => { deferredPrompt = null; renderInstall(); VIZ.toast(`${cfg.name} installed`, "Open it from your home screen or apps"); });
function renderInstall() {
  const can = !isStandalone && (deferredPrompt || isIOS || isMacSafari);
  $("acctInstall").style.display = can ? "" : "none";
  $("startInstall").style.display = can ? "" : "none";
}
$("startInstall").onclick = () => $("acctInstall").onclick();
$("iosHintX").onclick = () => { $("iosHint").classList.remove("open"); localSet({ iosHintSeen: true }); };
// iPhone Safari can't show an install button, so point at the Share button once after sign-in
function maybeIosHint() { if (isIOS && !isStandalone && !localGet().iosHintSeen) setTimeout(() => $("iosHint").classList.add("open"), 2500); }
$("acctInstall").onclick = async () => {
  $("acctMenu").classList.remove("open");
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; renderInstall(); return; }
  if (isIOS) { $("iosHint").classList.add("open"); return; }
  if (false) return confirmDialog("Install on iPhone / iPad", "In Safari, tap the Share button (square with an arrow), then “Add to Home Screen”. The app then opens full-screen like a normal app.", "Got it", "");
  if (isMacSafari) return confirmDialog("Install on Mac", "In Safari's menu bar choose File → Add to Dock. It then opens in its own window like a normal app.", "Got it", "");
};
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1"))
  navigator.serviceWorker.register("sw.js").catch(() => {});

/* ───────── boot ───────── */
async function afterSignIn(user) {
  me = user; hideAuth(); renderAccount();
  await refreshStatus();
  maybeIosHint();
  if (st && !st.lifetime && remaining > 0) VIZ.toast(`Signed in — ${fmt(remaining)} of free visuals left today`, "Unlock forever any time from your account menu");
}
async function boot() {
  try { be = await createBackend(cfg); }
  catch (e) { showAuth("signin"); authMsg("Can't reach the account server. Check your connection and reload."); return; }
  $("demoNote").style.display = be.mode === "demo" ? "" : "none";
  be.price && be.price().then((p) => { if (p) { priceLabel = p; renderAccount(); } }).catch(() => {});
  be.onChange(async (ev, user) => {
    if (ev === "PASSWORD_RECOVERY") { showAuth("newpw"); return; }
    if (user && (!me || me.id !== user.id)) await afterSignIn(user);
    if (!user && me) { me = null; st = null; pending = 0; remaining = 0; VIZ.stopAll(); renderPill(); renderAccount(); hidePaywall(); showAuth("signin"); }
  });
  const u = await be.session();
  if (u) await afterSignIn(u); else showAuth("signup");
  renderInstall();
}
window.__app = { state: () => ({ me, st, remaining, pending }), flush };
boot();
