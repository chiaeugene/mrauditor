// Supabase Edge Function: admin-users
//
// Creating a login with a known password needs the SERVICE ROLE key, and
// Mr Auditor is a static browser app whose anon key is public — so this work
// can only happen server-side. This function is the single door: a firm admin
// creates a colleague's login here, hands over the password, and the colleague
// signs in fresh. There is no self-signup anywhere in the product.
//
// Authorisation is the caller's OWN session, never a shared secret: the JWT
// identifies them, their app_users row decides what they may do, and a firm
// admin can only ever touch their own firm. The service key is used strictly
// to execute an action already authorised — it is never a way in.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/** Readable but unguessable: 4 letters + 4 digits, no lookalike characters. */
function tempPassword(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ", d = "23456789";
  const pick = (s: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => s[x % s.length]).join("");
  return `${pick(a, 4)}-${pick(d, 4)}`;
}

const FIRM_ROLES = ["admin", "partner", "manager", "staff"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!service) return json({ error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY missing" }, 500);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // Who is asking? Resolved from their own JWT, not from anything they sent.
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Sign in first" }, 401);

    const admin = createClient(url, service);
    const { data: me } = await admin.from("app_users").select("*").eq("id", user.id).maybeSingle();
    if (!me || !me.active) return json({ error: "Your account is not active" }, 403);

    const isPlatform = me.role === "super_admin";
    const isAdmin = me.role === "admin" || isPlatform;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // Every action below is scoped to the caller's own firm unless they are
    // the platform. A firm admin cannot name another firm, so cross-firm
    // access is impossible rather than merely forbidden.
    const targetFirm = isPlatform && body.firm_id ? String(body.firm_id) : me.firm_id;

    /** Guard: the user being acted on must sit inside the caller's scope. */
    const loadTarget = async (id: string) => {
      const { data: t } = await admin.from("app_users").select("*").eq("id", id).maybeSingle();
      if (!t) return { error: "User not found" };
      if (!isPlatform && t.firm_id !== me.firm_id) return { error: "That user is not in your firm" };
      if (t.id === me.id) return { error: "You cannot do that to your own login" };
      return { target: t };
    };

    if (action === "list") {
      const q = admin.from("app_users").select("id,email,name,role,active,must_change_password,created_at")
        .order("created_at");
      const { data, error } = isPlatform && !body.firm_id ? await q : await q.eq("firm_id", targetFirm);
      if (error) throw new Error(error.message);
      return json({ users: data });
    }

    if (action === "create") {
      if (!isAdmin) return json({ error: "Only a firm admin can create logins" }, 403);
      if (!targetFirm) return json({ error: "Your login is not attached to a firm yet" }, 400);
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      const role = String(body.role ?? "staff");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address" }, 400);
      if (!FIRM_ROLES.includes(role)) return json({ error: "Unknown role" }, 400);
      // Only the platform may mint another platform user or an agent.
      const password = String(body.password ?? "").trim() || tempPassword();
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password,
        email_confirm: true,               // no confirmation email — they sign in immediately
        user_metadata: { name },
      });
      if (cErr) {
        return json({ error: /registered|exists/i.test(cErr.message)
          ? "That email already has a login" : cErr.message }, 400);
      }
      const { error: pErr } = await admin.from("app_users").insert({
        id: created.user!.id, firm_id: targetFirm, email, name, role,
        active: true, must_change_password: true,
      });
      if (pErr) {
        // Never leave an auth user without a profile — it would be a login
        // that can sign in and see nothing, with no way to manage it.
        await admin.auth.admin.deleteUser(created.user!.id);
        throw new Error(pErr.message);
      }
      return json({ ok: true, email, password, note: "Hand these over. They must change the password at first sign-in." });
    }

    if (action === "reset_password") {
      if (!isAdmin) return json({ error: "Only a firm admin can reset a password" }, 403);
      const { target, error } = await loadTarget(String(body.user_id ?? ""));
      if (error) return json({ error }, 400);
      const password = tempPassword();
      const { error: uErr } = await admin.auth.admin.updateUserById(target!.id, { password });
      if (uErr) throw new Error(uErr.message);
      await admin.from("app_users").update({ must_change_password: true }).eq("id", target!.id);
      return json({ ok: true, email: target!.email, password });
    }

    if (action === "set_active") {
      if (!isAdmin) return json({ error: "Only a firm admin can enable or disable a login" }, 403);
      const { target, error } = await loadTarget(String(body.user_id ?? ""));
      if (error) return json({ error }, 400);
      const active = !!body.active;
      // Flip the profile AND ban the auth user: a disabled login must not be
      // able to obtain a session at all, not merely be hidden by the app.
      await admin.from("app_users").update({ active }).eq("id", target!.id);
      const { error: bErr } = await admin.auth.admin.updateUserById(target!.id,
        { ban_duration: active ? "none" : "876000h" });
      if (bErr) throw new Error(bErr.message);
      return json({ ok: true, active });
    }

    if (action === "set_role") {
      if (!isAdmin) return json({ error: "Only a firm admin can change a role" }, 403);
      const role = String(body.role ?? "");
      if (!FIRM_ROLES.includes(role)) return json({ error: "Unknown role" }, 400);
      const { target, error } = await loadTarget(String(body.user_id ?? ""));
      if (error) return json({ error }, 400);
      await admin.from("app_users").update({ role }).eq("id", target!.id);
      return json({ ok: true, role });
    }

    // ── Platform actions: running the subscription business ──────────────────
    // Everything below is super_admin only. These are the same operations
    // Elaine's console performs, exposed here so Mr Auditor can be sold and
    // administered on its own without depending on another product.

    if (action === "create_firm") {
      if (!isPlatform) return json({ error: "Platform only" }, 403);
      const firmName = String(body.firm_name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim() || "Firm administrator";
      const afNo = String(body.af_no ?? "").trim() || null;
      const monthlyPrice = Number(body.monthly_price ?? 0) || 0;
      const agentId = String(body.agent_id ?? "").trim() || null;
      if (!firmName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "A firm name and a valid administrator email are required" }, 400);
      }
      const { data: clash } = await admin.from("app_users").select("id").eq("email", email).maybeSingle();
      if (clash) return json({ error: "That email already has a login" }, 400);

      const { data: firm, error: fErr } = await admin.from("firms").insert({
        name: firmName, af_no: afNo, monthly_price: monthlyPrice, agent_id: agentId,
        subscription_started_on: new Date().toISOString().slice(0, 10),
      }).select().single();
      if (fErr) throw new Error(fErr.message);

      const password = String(body.password ?? "").trim() || tempPassword();
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (cErr) {
        await admin.from("firms").delete().eq("id", firm.id);   // never strand an empty firm
        return json({ error: cErr.message }, 400);
      }
      const { error: pErr } = await admin.from("app_users").insert({
        id: created.user!.id, firm_id: firm.id, email, name,
        role: "admin", active: true, must_change_password: true,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user!.id);
        await admin.from("firms").delete().eq("id", firm.id);
        throw new Error(pErr.message);
      }
      return json({ ok: true, firm_id: firm.id, firm_name: firm.name, email, password });
    }

    if (action === "create_agent") {
      if (!isPlatform) return json({ error: "Platform only" }, 403);
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim() || "Agent";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address" }, 400);
      const password = String(body.password ?? "").trim() || tempPassword();
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (cErr) return json({ error: /registered|exists/i.test(cErr.message) ? "That email already has a login" : cErr.message }, 400);
      // An agent belongs to no firm — they manage many — and reports to the
      // platform user who created them.
      const { error: pErr } = await admin.from("app_users").insert({
        id: created.user!.id, firm_id: null, email, name,
        role: "agent", active: true, must_change_password: true, parent_id: me.id,
      });
      if (pErr) { await admin.auth.admin.deleteUser(created.user!.id); throw new Error(pErr.message); }
      return json({ ok: true, email, password });
    }

    if (action === "set_firm_active") {
      if (!isPlatform) return json({ error: "Platform only" }, 403);
      const { error } = await admin.from("firms").update({ active: !!body.active })
        .eq("id", String(body.firm_id ?? ""));
      if (error) throw new Error(error.message);
      return json({ ok: true, active: !!body.active });
    }

    if (action === "set_firm_price") {
      if (!isPlatform) return json({ error: "Platform only" }, 403);
      const price = Number(body.monthly_price);
      if (!(price >= 0)) return json({ error: "Enter a valid monthly price" }, 400);
      const { error } = await admin.from("firms").update({ monthly_price: price })
        .eq("id", String(body.firm_id ?? ""));
      if (error) throw new Error(error.message);
      return json({ ok: true, monthly_price: price });
    }

    if (action === "record_payment") {
      if (!isPlatform) return json({ error: "Platform only" }, 403);
      const firmId = String(body.firm_id ?? "");
      const amount = Number(body.amount);
      if (!firmId || !(amount > 0)) return json({ error: "A firm and a positive amount are required" }, 400);
      const { data: firm } = await admin.from("firms").select("*").eq("id", firmId).maybeSingle();
      if (!firm) return json({ error: "Firm not found" }, 400);

      // Commission is SNAPSHOTTED at today's tier. Moving an agent up a tier
      // later must never silently rewrite what they already earned, so the
      // rate is stored on the payment rather than recomputed on display.
      let ratePct = 0, commission = 0;
      if (firm.agent_id) {
        const { count } = await admin.from("firms")
          .select("id", { count: "exact", head: true }).eq("agent_id", firm.agent_id).eq("active", true);
        const { data: tiers } = await admin.from("commission_tiers").select("*").order("min_clients");
        const tier = (tiers ?? []).filter((t) => (count ?? 0) >= t.min_clients).pop();
        ratePct = tier ? Number(tier.rate_pct) : 0;
        commission = Math.round(amount * ratePct) / 100;
      }
      const { error } = await admin.from("agency_payments").insert({
        firm_id: firmId, amount, paid_on: String(body.paid_on ?? "").trim() || new Date().toISOString().slice(0, 10),
        note: String(body.note ?? "").trim() || null,
        agent_id: firm.agent_id, rate_pct: ratePct, commission, recorded_by: me.id,
      });
      if (error) throw new Error(error.message);
      return json({ ok: true, rate_pct: ratePct, commission });
    }

    if (action === "record_payout") {
      if (!isPlatform) return json({ error: "Platform only" }, 403);
      const agentId = String(body.agent_id ?? "");
      const amount = Number(body.amount);
      if (!agentId || !(amount > 0)) return json({ error: "An agent and a positive amount are required" }, 400);
      const { error } = await admin.from("agency_payouts").insert({
        agent_id: agentId, amount,
        paid_on: String(body.paid_on ?? "").trim() || new Date().toISOString().slice(0, 10),
        note: String(body.note ?? "").trim() || null,
      });
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
