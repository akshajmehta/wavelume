// Backend adapter: real Supabase when configured, otherwise a local demo that mimics it.
// Both expose the same methods, so the rest of the app doesn't care which one is running.

const norm = (d) => ({
  lifetime: !!d.lifetime,
  used: d.used | 0,
  limit: d.limit | 0,
  resetsAt: new Date(d.resets_at || d.resetsAt),
});
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d; };

export async function createBackend(cfg) {
  return cfg.supabaseUrl && cfg.supabaseAnonKey ? supabaseBackend(cfg) : demoBackend(cfg);
}

/* ───────────────────────── Supabase (live) ───────────────────────── */
async function supabaseBackend(cfg) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const here = location.origin + location.pathname;
  const user = (s) => (s && s.user ? { id: s.user.id, email: s.user.email } : null);

  async function fn(action, extra = {}) {
    const { data, error } = await sb.functions.invoke("checkout", { body: { action, ...extra } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    return data;
  }

  return {
    mode: "live",
    async session() { const { data } = await sb.auth.getSession(); return user(data.session); },
    onChange(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, user(s))); },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here } });
      if (error) throw error;
      return { needsConfirm: !data.session };
    },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async google() { const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here } }); if (error) throw error; },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here }); if (error) throw error; },
    async setNewPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; },
    async signOut() { await sb.auth.signOut(); },
    async deleteAccount() { await fn("delete-account"); await sb.auth.signOut(); },
    async status() { const { data, error } = await sb.rpc("get_status"); if (error) throw error; return norm(data); },
    async useTime(seconds) { const { data, error } = await sb.rpc("use_time", { p_seconds: seconds }); if (error) throw error; return norm(data); },
    async submitPayment(utr) { const { data, error } = await sb.rpc("submit_payment", { p_utr: utr }); if (error) throw error; return data; },
    async paymentStatus() { const { data, error } = await sb.rpc("my_payment_status"); return error ? null : data; },
    async isAdmin() { const { data, error } = await sb.rpc("is_admin"); return !error && !!data; },
    async adminList(status) { const { data, error } = await sb.rpc("admin_list_requests", { p_status: status }); if (error) throw error; return data || []; },
    async adminDecide(id, approve) { const { data, error } = await sb.rpc("admin_decide", { p_id: id, p_approve: approve }); if (error) throw error; return data; },
    async adminStats() { const { data, error } = await sb.rpc("admin_stats"); if (error) throw error; return data; },
    async adminUsers(filter) { const { data, error } = await sb.rpc("admin_list_users", { p_filter: filter || "all" }); if (error) throw error; return data || []; },
    async price() {
      if (cfg.upi) return cfg.priceLabel;
      const c = await fn("config");
      try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c.currency, maximumFractionDigits: 0 }).format(c.amount / 100); }
      catch (_) { return null; }
    },
    // Resolves true when unlocked, false if the buyer closed the checkout.
    async checkout(ui) {
      const c = await fn("config");
      if (c.mode === "test") {
        if (!(await ui.confirm("Test purchase", "Payments are in test mode — no money will be charged. Unlock this account?", "Unlock (test)"))) return false;
        await fn("test-unlock");
        return true;
      }
      const o = await fn("create-order");
      await loadScript("https://checkout.razorpay.com/v1/checkout.js");
      return new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency,
          name: cfg.name, description: "Lifetime unlock", prefill: { email: o.email },
          notes: { product: "lifetime" }, theme: { color: "#2b8fd6" },
          handler: async (r) => { try { await fn("verify", r); resolve(true); } catch (e) { reject(e); } },
          modal: { ondismiss: () => resolve(false) },
        });
        rz.on("payment.failed", (e) => reject(new Error((e.error && e.error.description) || "Payment failed")));
        rz.open();
      });
    },
  };
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error("Could not load the payment window. Check your connection."));
    document.head.appendChild(s);
  });
}

/* ───────────────────────── Demo (this browser only) ───────────────────────── */
async function demoBackend(cfg) {
  const KEY = "wavelume_demo_v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { users: {}, usage: {}, session: null }; } catch (_) { return { users: {}, usage: {}, session: null }; } };
  const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {} };
  const hash = async (s) => { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wl:" + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const listeners = [];
  const emit = (ev) => { const d = load(); listeners.forEach((cb) => cb(ev, d.session ? { id: d.session, email: d.session } : null)); };
  const status = () => {
    const d = load(), u = d.users[d.session] || {};
    return { lifetime: !!u.lifetime, used: d.usage[d.session + "|" + utcDay()] | 0, limit: cfg.freeSecondsPerDay, resetsAt: nextUtcMidnight() };
  };
  const err = (m) => Object.assign(new Error(m), { demo: true });
  const refOf = (email) => [...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
  return {
    mode: "demo",
    async session() { const d = load(); return d.session ? { id: d.session, email: d.session } : null; },
    onChange(cb) { listeners.push(cb); },
    async signUp(email, password) {
      const d = load(); email = email.trim().toLowerCase();
      if (d.users[email]) throw err("An account with this email already exists. Sign in instead.");
      d.users[email] = { pw: await hash(password), lifetime: false }; d.session = email; save(d); emit("SIGNED_IN");
      return { needsConfirm: false };
    },
    async signIn(email, password) {
      const d = load(); email = email.trim().toLowerCase();
      if (!d.users[email] || d.users[email].pw !== (await hash(password))) throw err("Wrong email or password.");
      d.session = email; save(d); emit("SIGNED_IN");
    },
    async google() { throw err("Google sign-in needs the live (Supabase) setup."); },
    async resetPassword() { throw err("Password reset emails need the live (Supabase) setup."); },
    async setNewPassword() {},
    async signOut() { const d = load(); d.session = null; save(d); emit("SIGNED_OUT"); },
    async deleteAccount() {
      const d = load(), u = d.session; if (!u) return;
      delete d.users[u]; Object.keys(d.usage).forEach((k) => { if (k.startsWith(u + "|")) delete d.usage[k]; });
      d.session = null; save(d); emit("SIGNED_OUT");
    },
    async status() { return status(); },
    async useTime(seconds) {
      const d = load(); if (!d.session) throw err("not signed in");
      if (!(d.users[d.session] || {}).lifetime) { const k = d.session + "|" + utcDay(); d.usage[k] = (d.usage[k] | 0) + Math.max(0, Math.min(30, seconds | 0)); save(d); }
      return status();
    },
    async price() { return cfg.priceLabel; },
    async submitPayment(utr) {
      const d = load(), clean = String(utr || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
      if (!/^[0-9A-Z]{10,22}$/.test(clean)) throw err("That doesn't look like a UPI transaction ID. It is usually 12 digits.");
      d.reqs = d.reqs || [];
      if (d.reqs.some((r) => r.utr === clean)) throw err("This transaction ID has already been submitted.");
      d.reqs.push({ id: d.reqs.length + 1, email: d.session, utr: clean, ref_code: refOf(d.session), amount: (cfg.upi ? cfg.upi.amount : 99) * 100, status: "pending", created_at: new Date().toISOString() });
      save(d); return { status: "pending", utr: clean };
    },
    async paymentStatus() { const d = load(), r = (d.reqs || []).filter((x) => x.email === d.session).pop(); return r ? { status: r.status, utr: r.utr } : null; },
    async isAdmin() { return load().session === "akshaj001@gmail.com"; },
    async adminList(status) { const d = load(); return (d.reqs || []).filter((r) => !status || r.status === status).reverse(); },
    async adminStats() {
      const d = load(), users = Object.entries(d.users), today = utcDay(), reqs = d.reqs || [];
      const ok = reqs.filter((r) => r.status === "approved");
      const act = (pred) => new Set(Object.keys(d.usage).filter((k) => d.usage[k] > 0 && pred(k.split("|")[1])).map((k) => k.split("|")[0])).size;
      return { registered: users.length, confirmed: users.length, paid: users.filter(([, u]) => u.lifetime).length, paid_upi: ok.length, revenue_paise: ok.reduce((a, r) => a + (r.amount || 0), 0),
        active_today: act((day) => day === today), active_7d: act(() => true), new_today: users.length, new_7d: users.length, pending: reqs.filter((r) => r.status === "pending").length };
    },
    async adminUsers(filter) {
      const d = load();
      return Object.entries(d.users).filter(([, u]) => filter === "paid" ? u.lifetime : filter === "free" ? !u.lifetime : true)
        .map(([email, u]) => ({ email, joined: null, last_sign_in: null, confirmed: true, lifetime: !!u.lifetime, lifetime_since: null,
          minutes_total: Math.floor(Object.keys(d.usage).filter((k) => k.startsWith(email + "|")).reduce((a, k) => a + d.usage[k], 0) / 60), last_active: null }));
    },
    async adminDecide(id, approve) {
      const d = load(), r = (d.reqs || []).find((x) => x.id === id); if (!r) throw err("request not found");
      r.status = approve ? "approved" : "rejected"; r.decided_at = new Date().toISOString();
      if (approve && d.users[r.email]) d.users[r.email].lifetime = true;
      save(d); return { id, status: r.status };
    },
    async checkout(ui) {
      if (!(await ui.confirm("Demo purchase", "This is demo mode — no payment is taken and the unlock only exists in this browser.", "Unlock (demo)"))) return false;
      const d = load(); d.users[d.session].lifetime = true; save(d); return true;
    },
  };
}
