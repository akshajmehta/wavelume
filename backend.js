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
    async price() {
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
    async checkout(ui) {
      if (!(await ui.confirm("Demo purchase", "This is demo mode — no payment is taken and the unlock only exists in this browser.", "Unlock (demo)"))) return false;
      const d = load(); d.users[d.session].lifetime = true; save(d); return true;
    },
  };
}
