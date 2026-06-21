// Supabase Edge Function: notify-application
// Emails the platform admin whenever a new church application is submitted,
// so you know to go approve it.
//
// HOW IT'S TRIGGERED:
//   A Supabase **Database Webhook** on INSERT into `church_applications` POSTs
//   the new row here. (Dashboard → Database → Webhooks → Create — see SETUP.)
//
// WHY RESEND:
//   Free tier = 3,000 emails/month / 100 per day. No credit card. Plenty for
//   approval pings. https://resend.com
//
// ── ONE-TIME SETUP ───────────────────────────────────────────────────────────
//   1. Create a free Resend account → API Keys → copy the key (re_xxx).
//      (Use Resend's "onboarding@resend.dev" sender to test with zero setup,
//       or verify your own domain later for a branded From address.)
//   2. From the project root:
//        supabase login
//        supabase link --project-ref tgnngqjgaiunmamigvjp
//        supabase secrets set RESEND_API_KEY=re_xxxxxxxx
//        supabase secrets set ADMIN_EMAIL=hyy7010@gmail.com
//        supabase secrets set FROM_EMAIL="GraceFlow <onboarding@resend.dev>"
//        supabase functions deploy notify-application
//   3. Dashboard → Database → Webhooks → Create a new hook:
//        Table: church_applications | Events: Insert
//        Type: Supabase Edge Function → notify-application
//
// After that, every new application emails ADMIN_EMAIL automatically. Free.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "GraceFlow <onboarding@resend.dev>";
// Where the admin clicks to go review. Override via secret if your URL differs.
const APP_URL = Deno.env.get("APP_URL") ?? "https://jzexy.xyz/app/super-admin";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!RESEND_API_KEY || !ADMIN_EMAIL) {
    return json({ error: "Server not configured: set RESEND_API_KEY and ADMIN_EMAIL secrets" }, 500);
  }

  // The DB webhook posts { type, table, record, old_record }. Be tolerant of
  // either that shape or a plain row if you call the function directly.
  let payload: any = {};
  try { payload = await req.json(); } catch { /* ignore */ }
  const app = payload?.record ?? payload ?? {};

  const churchName = app.church_name ?? "(unknown church)";
  const leader = app.leader_name ?? "(unknown)";
  const email = app.email ?? "—";
  const phone = app.phone ?? "—";

  const subject = `🆕 New church application: ${churchName}`;
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#059669;margin:0 0 4px">New church application</h2>
      <p style="color:#555;margin:0 0 16px">Someone just applied — review and approve.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#888">Church</td><td style="padding:6px 0;font-weight:700">${churchName}</td></tr>
        <tr><td style="padding:6px 0;color:#888">Applicant</td><td style="padding:6px 0;font-weight:700">${leader}</td></tr>
        <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${email}</td></tr>
        <tr><td style="padding:6px 0;color:#888">Phone</td><td style="padding:6px 0">${phone}</td></tr>
      </table>
      <a href="${APP_URL}" style="display:inline-block;margin-top:20px;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:700;font-size:13px">Review &amp; approve →</a>
    </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [ADMIN_EMAIL], subject, html }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    return json({ error: "Resend failed", detail }, 502);
  }

  return json({ ok: true });
});
