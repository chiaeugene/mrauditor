// Supabase Edge Function: ask-mr-auditor
// Proxies Ask Mr Auditor questions to the Anthropic API so the API key stays
// server-side. Deployed with verify_jwt on (default), so only signed-in users
// of the app can call it. Secret required: ANTHROPIC_API_KEY.
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SYSTEM = `You are Mr Auditor, a senior audit manager at a Malaysian audit firm, answering questions from the engagement team inside the Mr Auditor web app.

Your expertise: Malaysian statutory audit under the Companies Act 2016 (Act 777), MPERS and MFRS, the Malaysian Approved Standards on Auditing (ISAs), the Income Tax Act 1967 (SME tiers, Schedule 3 capital allowances, s.140B, CP204), SSM practice (PD 10/2024 audit exemption, MBRS lodgement, statutory deadlines), SST and MyInvois e-invoicing.

You are given the current engagement's data as JSON context: company particulars, key figures, materiality, open audit findings, and trial balance summaries. Ground every answer in that data — quote the actual numbers and name the actual accounts. If the data doesn't contain what you need, say what's missing and how the auditor would obtain it.

Style: direct and practical, like a manager coaching a junior on the file. Cite the specific law or standard (e.g. "s.131 CA 2016", "MPERS s.17", "ISA 570") when it drives the answer. Keep answers tight — a few short paragraphs or a brief list, not an essay. Use RM formatting for amounts.

Boundaries: this tool prepares draft audit work for a licensed auditor (s.263 approval) to review and sign — remind the user of that only when they ask you to make a judgement that belongs to the signing partner (opinion decisions, going-concern conclusions). Never invent figures that aren't in the context.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(
      { error: "AI not configured: ANTHROPIC_API_KEY secret is not set" },
      500,
    );
  }

  try {
    const { question, context } = await req.json();
    if (!question || typeof question !== "string") {
      return json({ error: "question is required" }, 400);
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Engagement context (JSON):\n${
              JSON.stringify(context ?? {}, null, 1)
            }\n\nQuestion: ${question}`,
        },
      ],
    });

    const answer = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    return json({ answer });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
