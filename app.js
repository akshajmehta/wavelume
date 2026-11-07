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
let priceLabel = cfg.priceLabel || "", isAdmin = false;
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
  if (payState && payState.status === "pending") { $("pwBuy").textContent = "Payment under review — view details"; $("pwMsg").textContent = "We've got your payment details and will unlock you soon."; $("pwMsg").className = "msg ok"; }
  if (payState && payState.status === "rejected") { $("pwMsg").textContent = "We couldn't verify your last payment. Try again or contact " + (cfg.supportEmail || "support") + "."; $("pwMsg").className = "msg err"; }
  $("paywall").classList.add("open"); document.body.classList.add("locked");
}
function hidePaywall() { $("paywall").classList.remove("open"); document.body.classList.remove("locked"); }
async function buy() {
  if (cfg.upi) { openUpi(); return; }
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

/* ───────── manual UPI payments ───────── */
const refCode = (u) => !u ? "" : /^[0-9a-f-]{36}$/i.test(u.id) ? u.id.replace(/-/g, "").slice(0, 6).toUpperCase()
  : [...(u.email || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
let payState = null, payPoll = 0;
const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function upiLink() {
  const u = cfg.upi, e = encodeURIComponent;
  return `upi://pay?pa=${e(u.id).replace(/%40/g, "@")}&pn=${e(u.name)}&am=${Number(u.amount).toFixed(2)}&cu=INR&tn=${e("Wavelume " + refCode(me))}`;
}
const QR_SRC = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js", QR_SRI = "sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k";
function loadScript(src, sri) { return new Promise((res, rej) => { if (window.qrcode) return res(); const s = document.createElement("script"); s.src = src; if (sri) { s.integrity = sri; s.crossOrigin = "anonymous"; } s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function buildUpi() {
  if ($("upi")) return;
  const st = document.createElement("style");
  st.textContent = `#upi .qr{width:200px;height:200px;margin:4px auto 10px;background:#fff;border-radius:14px;padding:10px;box-sizing:content-box}#upi .qr svg{width:100%;height:100%;display:block}
  #upi .steps{text-align:left;font-size:13px;color:#cfd6e0;margin:0 0 10px;padding-left:20px}#upi .steps li{margin:4px 0}
  #upi .idrow{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 0 6px;font-size:14px}#upi code{background:rgba(255,255,255,.08);padding:4px 8px;border-radius:7px;font-size:13px}
  #upi .ref{font-size:13px;color:#cfd6e0;margin-bottom:10px}#upi .ref b{color:#fff;letter-spacing:.08em}
  #upi .mini{background:none;border:1px solid rgba(255,255,255,.2);color:#e8ecf2;border-radius:7px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}
  #upi .payapp{display:none;margin:2px 0 12px}#upi.phone .payapp{display:flex}#upi.phone .qrwrap{display:none}#upi.phone .qrhint{display:block}
  #upi .qrhint{display:none;font-size:12px;color:#9aa3b2;margin:-4px 0 10px}#upi .qrhint button{color:var(--acc);background:none;border:0;font:inherit;cursor:pointer;text-decoration:underline}
  #upi .done{display:none}#upi.sent .form{display:none}#upi.sent .done{display:block}#upi .done .tick{font-size:42px;line-height:1;margin:6px 0 8px}`;
  document.head.appendChild(st);
  const ov = document.createElement("div");
  ov.id = "upi"; ov.className = "ov";
  ov.innerHTML = `<div class="panel">
    <button class="x" type="button" id="upiX" aria-label="Close">×</button>
    <div class="logo">${cfg.name}</div>
    <div class="form">
      <h2>Unlock forever · ${cfg.priceLabel}</h2>
      <p class="sub" style="margin-bottom:10px">One-time UPI payment. No subscription.</p>
      <a class="big wide payapp" id="upiApp" href="#">Pay ${cfg.priceLabel} with a UPI app</a>
      <div class="qrwrap"><div class="qr" id="upiQr"></div></div>
      <div class="qrhint">On a computer? <button type="button" id="upiShowQr">Show QR code</button></div>
      <div class="idrow">UPI ID <code id="upiId"></code><button class="mini" type="button" id="upiCopy">Copy</button></div>
      <div class="ref">Your code: <b id="upiRef"></b> <span style="color:#9aa3b2">(added to the payment note)</span></div>
      <ol class="steps"><li>Pay <b>${cfg.priceLabel}</b> with GPay, PhonePe, Paytm or any UPI app.</li><li>Copy the <b>UPI transaction ID</b> (12 digits, also called UTR) from the payment receipt.</li><li>Paste it below and submit.</li></ol>
      <input id="upiUtr" inputmode="numeric" autocomplete="off" placeholder="UPI transaction ID (e.g. 412345678901)">
      <button class="big wide" type="button" id="upiSubmit">I've paid — submit</button>
      <div class="msg" id="upiMsg" role="status"></div>
    </div>
    <div class="done">
      <div class="tick">✓</div><h2>Payment submitted</h2>
      <p class="sub" id="upiDoneText">We'll check it and unlock your account, usually within a few hours. This page updates by itself — you can close it.</p>
      <button class="big wide" type="button" id="upiDoneOk">OK</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  $("upiX").onclick = $("upiDoneOk").onclick = () => ov.classList.remove("open");
  $("upiShowQr").onclick = () => ov.classList.remove("phone");
  $("upiCopy").onclick = async () => { try { await navigator.clipboard.writeText(cfg.upi.id); $("upiCopy").textContent = "Copied"; setTimeout(() => ($("upiCopy").textContent = "Copy"), 1500); } catch (_) {} };
  $("upiSubmit").onclick = submitUtr;
  $("upiUtr").addEventListener("keydown", (e) => { if (e.key === "Enter") submitUtr(); });
}
async function openUpi() {
  buildUpi();
  const ov = $("upi");
  ov.classList.toggle("phone", isPhone);
  ov.classList.toggle("sent", !!(payState && payState.status === "pending"));
  $("upiId").textContent = cfg.upi.id; $("upiRef").textContent = refCode(me);
  $("upiApp").href = upiLink(); $("upiMsg").textContent = ""; $("upiMsg").className = "msg";
  hidePaywall(); ov.classList.add("open");
  try { await loadScript(QR_SRC, QR_SRI).catch(() => loadScript("qrcode.js")); const q = window.qrcode(0, "M"); q.addData(upiLink()); q.make(); $("upiQr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch (_) { $("upiQr").textContent = "QR unavailable — use the UPI ID below"; }
}
async function submitUtr() {
  const utr = $("upiUtr").value.trim();
  if (!/^[0-9A-Za-z\s-]{10,26}$/.test(utr)) { $("upiMsg").textContent = "Paste the UPI transaction ID from your payment receipt — usually 12 digits."; $("upiMsg").className = "msg err"; return; }
  $("upiSubmit").disabled = true;
  try { payState = await be.submitPayment(utr); $("upi").classList.add("sent"); startPayPoll(); renderAccount(); }
  catch (e) { $("upiMsg").textContent = niceErr(e); $("upiMsg").className = "msg err"; }
  finally { $("upiSubmit").disabled = false; }
}
function startPayPoll() {
  clearInterval(payPoll);
  payPoll = setInterval(async () => {
    if (!me) return clearInterval(payPoll);
    await refreshStatus();
    if (st && st.lifetime) { clearInterval(payPoll); payState = { status: "approved" }; $("upi") && $("upi").classList.remove("open"); hidePaywall(); renderAccount(); VIZ.toast(`Payment approved — ${cfg.name} is unlocked forever`, "Thank you for supporting it!"); return; }
    const ps = await be.paymentStatus().catch(() => null);
    if (ps && ps.status === "rejected") { clearInterval(payPoll); payState = ps; renderAccount(); VIZ.toast("We couldn't verify your payment", cfg.supportEmail ? "Contact " + cfg.supportEmail : ""); }
  }, 45000);
}
async function checkPayment() {
  if (!cfg.upi || !me || (st && st.lifetime) || !be.paymentStatus) return;
  payState = await be.paymentStatus().catch(() => null);
  if (payState && payState.status === "pending") startPayPoll();
  renderAccount();
}

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
  $("acctPlan").textContent = st && st.lifetime ? "Lifetime — unlimited" : payState && payState.status === "pending" ? "Payment under review" : `Free — ${Math.round((st ? st.limit : 240) / 60)} min per day`;
  const ad = $("acctAdmin"); if (ad) ad.style.display = isAdmin ? "" : "none";
  $("acctBuy").style.display = st && !st.lifetime ? "" : "none";
  $("acctBuy").textContent = payState && payState.status === "pending" ? "Payment under review" : `Unlock forever · ${priceLabel}`;
}
{ const a = document.createElement("a"); a.id = "acctAdmin"; a.className = "mlink"; a.href = "admin.html"; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Admin — approve payments"; a.style.display = "none"; a.style.color = "var(--acc)"; $("acctMenu").insertBefore(a, $("acctBuy")); }
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
  checkPayment();
  if (be.isAdmin) be.isAdmin().then((v) => { isAdmin = v; renderAccount(); }).catch(() => {});
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
    if (!user && me) { me = null; st = null; pending = 0; remaining = 0; payState = null; isAdmin = false; clearInterval(payPoll); VIZ.stopAll(); renderPill(); renderAccount(); hidePaywall(); showAuth("signin"); }
  });
  const u = await be.session();
  if (u) await afterSignIn(u); else showAuth("signup");
  renderInstall();
}
window.__app = { state: () => ({ me, st, remaining, pending }), flush };
boot();
