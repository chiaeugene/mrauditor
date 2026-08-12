// Supabase Edge Function: provision-firm
//
// One call creates a paying audit firm: the firm record, its first admin
// login, the subscription price and the module flags — and hands back the
// credentials to put in the welcome message. Same shape as Lily's
// /api/provision/tenant, so Elaine's console can sell Mr Auditor the way it
// already sells Lily, without anyone running SQL.
//
// Authenticated by a single platform token, NOT a user session: the caller is
// Elaine's server, not a person. That token creates firms, so it is the most
// powerful secret here — it lives only in Elaine's secrets, is required to be
// long, and is compared by hash so a timing difference reveals nothing.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MRAUDITOR_PROVISION_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
function tempPassword(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ", d = "23456789";
  const pick = (s: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => s[x % s.length]).join("");
  return `${pick(a, 4)}-${pick(d, 4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const expected = Deno.env.get("MRAUDITOR_PROVISION_TOKEN") ?? "";
  // An unset or weak secret must never mean "everyone is authorised".
  if (expected.length < 24) return json({ error: "Provisioning is not configured" }, 503);
  const got = (/^Bearer\s+(.+)$/i.exec((req.headers.get("Authorization") ?? "").trim()) ?? [])[1] ?? "";
  if (!got || (await sha256(got)) !== (await sha256(expected))) return json({ error: "unauthorised" }, 401);

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!service) return json({ error: "Server not configured" }, 500);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, service);

  try {
    const b = await req.json().catch(() => ({}));
    const firmName = String(b.firm_name ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const name = String(b.name ?? "").trim() || "Firm administrator";
    const afNo = String(b.af_no ?? "").trim() || null;
    const monthlyPrice = Number(b.monthly_price ?? 0) || 0;
    const agentEmail = String(b.agent_email ?? "").trim().toLowerCase();
    const disabled: string[] = Array.isArray(b.disabled_features) ? b.disabled_features.map(String) : [];
    let password = String(b.password ?? "").trim();

    if (!firmName || !email) return json({ error: "firm_name and email are required" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "email is not valid" }, 400);
    if (password && password.length < 8) return json({ error: "password must be at least 8 characters" }, 400);

    // Idempotency. Elaine retries on a dropped connection, and provisioning
    // the same firm twice is far worse than refusing: it would leave a
    // duplicate firm and an orphaned login. Keyed on the admin's email, which
    // is unique in auth.
    const { data: existing } = await db.from("app_users").select("id,firm_id,email").eq("email", email).maybeSingle();
    if (existing) {
      const { data: firm } = await db.from("firms").select("*").eq("id", existing.firm_id).maybeSingle();
      return json({ ok: true, already_provisioned: true, firm_id: existing.firm_id,
        firm_name: firm?.name ?? firmName, email,
        note: "This email already has a login; nothing was changed." });
    }

    // Which agent recruited them (optional — a direct sale has none).
    let agentId: string | null = null;
    if (agentEmail) {
      const { data: agent } = await db.from("app_users").select("id,role").eq("email", agentEmail).maybeSingle();
      if (!agent || agent.role !== "agent") return json({ error: `No agent with the email ${agentEmail}` }, 400);
      agentId = agent.id;
    }

    const { data: firm, error: fErr } = await db.from("firms").insert({
      name: firmName, af_no: afNo, monthly_price: monthlyPrice,
      subscription_started_on: new Date().toISOString().slice(0, 10), agent_id: agentId,
    }).select().single();
    if (fErr) throw new Error(fErr.message);

    if (!password) password = tempPassword();
    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (cErr) {
      await db.from("firms").delete().eq("id", firm.id);   // don't strand an empty firm
      return json({ error: cErr.message }, 400);
    }

    const { error: pErr } = await db.from("app_users").insert({
      id: created.user!.id, firm_id: firm.id, email, name,
      role: "admin", active: true, must_change_password: true,
    });
    if (pErr) {
      await db.auth.admin.deleteUser(created.user!.id);
      await db.from("firms").delete().eq("id", firm.id);
      throw new Error(pErr.message);
    }

    // Feature flags are default-ON, so only switch-offs are written.
    if (disabled.length) {
      await db.from("firm_features").upsert(
        disabled.map((f) => ({ firm_id: firm.id, feature: f, enabled: false })));
    }

    return json({
      ok: true, firm_id: firm.id, firm_name: firm.name, email, password,
      login_url: "https://mrauditor.onrender.com",
      note: "Hand these over. The administrator must change the password at first sign-in, and can then create the rest of the firm's logins.",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
