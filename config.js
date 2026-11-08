// ─────────────────────────────────────────────────────────────
//  Wavelume settings — the only file you need to edit to launch
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  // App name shown everywhere (also change "name" in manifest.webmanifest).
  name: "Wavelume",

  // Supabase project (Dashboard → Project Settings → API).
  // Leave both EMPTY to run in local DEMO mode: accounts and purchases are
  // simulated inside this browser only — good for trying the flow, not for launch.
  supabaseUrl: "https://ftkixcrnqgzniakhozbs.supabase.co",
  supabaseAnonKey: "sb_publishable_xIHClhfe0vsbfwrXN04ZHg_UAfVjM-d",

  // Free seconds per day. In live mode the server's value (supabase/schema.sql) is what counts;
  // this number is only used in demo mode.
  freeSecondsPerDay: 240,
  // New accounts get this many hours of unlimited use first (must match free_trial_hours() in trial.sql).
  trialHours: 0,

  // Shown on the unlock button until the server reports the real price.
  priceLabel: "₹99",

  // Manual UPI payments: buyers pay this UPI ID, then you approve them on admin.html.
  // Remove this block to use the Razorpay / test checkout instead.
  upi: { id: "akshaj.mehta@ptaxis", name: "Akshaj Mehta", amount: 99 },

  // Show "Continue with Google" (turn on Google in Supabase → Authentication → Providers first).
  googleSignIn: true,
  // Google OAuth client ID (public, not a secret) — enables Google's own sign-in button.
  googleClientId: "715869191125-emj8mv5n111c90h8afim1s1bbm995cqn.apps.googleusercontent.com",

  // Shown on the paywall / account menu.
  supportEmail: "workwithdrakshaj@gmail.com",
};
