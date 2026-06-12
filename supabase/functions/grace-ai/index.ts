// Supabase Edge Function: grace-ai
// Server-side proxy for the Grace Assistant.
//
// WHY THIS EXISTS:
//   The NVIDIA inference API does not return CORS headers on the preflight
//   (OPTIONS) request, so a browser cannot call it directly — it fails with
//   "Failed to fetch". This function runs server-side, holds the API key as a
//   secret (never exposed to the browser), and returns proper CORS headers.
//
// DEPLOY (run once, from the project root):
//   1. supabase login
//   2. supabase link --project-ref tgnngqjgaiunmamigvjp
//   3. supabase secrets set NVIDIA_API_KEY=nvapi-xxxxxxxx   # your NVIDIA key
//   4. supabase functions deploy grace-ai
//
// The browser then calls:  {VITE_SUPABASE_URL}/functions/v1/grace-ai

const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!NVIDIA_API_KEY) {
    return json(
      { error: "NVIDIA_API_KEY is not set. Run: supabase secrets set NVIDIA_API_KEY=..." },
      500,
    );
  }

  try {
    const { messages, model, temperature, max_tokens } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "`messages` array is required" }, 400);
    }

    const upstream = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "meta/llama-3.3-70b-instruct",
        messages,
        temperature: temperature ?? 0.4,
        max_tokens: max_tokens ?? 2048,
      }),
    });

    const data = await upstream.json();
    return json(data, upstream.status);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
