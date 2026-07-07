// Supabase Edge Function: ask-mr-auditor
// Proxies Ask Mr Auditor / document-intelligence requests to the Anthropic
// API so the API key stays server-side. Deployed with verify_jwt on
// (default), so only signed-in users of the app can call it.
// Secret required: ANTHROPIC_API_KEY.
//
// Document intelligence: when `documentIds` is supplied, this function
// downloads each vault file from Supabase Storage using a client scoped to
// the CALLER'S OWN JWT — so row-level security decides what it can read,
// never a service-role bypass — and attaches the actual file to the Claude
// request as a native `document` (PDF) or `image` block. Claude reads PDFs
// and images natively, page by page; we do not run our own OCR/extraction,
// which is the more reliable choice and the one least likely to silently
// drop information. Any file that can't be attached (unsupported type, or
// would push the request over Anthropic's hard size ceiling) is EXCLUDED
// EXPLICITLY and reported back in `skipped` — never silently dropped.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";

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

You are given the current engagement's data as JSON context: company particulars, key figures, materiality, open audit findings, and trial balance summaries. You may also be given actual source documents (PDFs, images, or text) filed as audit evidence — read every page of every document supplied in full before answering; do not skim or summarize from the filename alone. Ground every answer in the actual data and documents — quote the actual numbers, name the actual accounts, and cite the specific document when a fact comes from one. If something you need is missing from the context or documents, say exactly what's missing and how the auditor would obtain it. Never invent a figure that isn't in the context or a supplied document.

Style: direct and practical, like a manager coaching a junior on the file. Cite the specific law or standard (e.g. "s.131 CA 2016", "MPERS s.17", "ISA 570") when it drives the answer. Use RM formatting for amounts.

Boundaries: this tool prepares draft audit work for a licensed auditor (s.263 approval) to review and sign — remind the user of that only when they ask you to make a judgement that belongs to the signing partner (opinion decisions, going-concern conclusions).`;

// Anthropic's hard request-body ceiling is 32MB; base64 inflates raw bytes by
// ~4/3, and we need headroom for the JSON context + system prompt. Cap the
// RAW (pre-base64) bytes we'll attach per request well under that line.
const MAX_TOTAL_RAW_BYTES = 20 * 1024 * 1024; // 20MB combined raw evidence per request
const MAX_SINGLE_FILE_BYTES = 15 * 1024 * 1024; // a single file this large is almost certainly not meant for inline reading

function guessMime(name: string, fallback: string | null): string {
  if (fallback) return fallback;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", csv: "text/csv", txt: "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

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
    const { question, context, documentIds } = await req.json();
    if (!question || typeof question !== "string") {
      return json({ error: "question is required" }, 400);
    }

    const skipped: { name: string; reason: string }[] = [];
    const docBlocks: Anthropic.Messages.ContentBlockParam[] = [];

    if (Array.isArray(documentIds) && documentIds.length) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      // Scoped to the caller's own JWT — RLS decides what this can read.
      // Never use a service-role key here.
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      let totalRaw = 0;
      for (const id of documentIds) {
        const { data: row, error: rowErr } = await supabase
          .from("evidence_files")
          .select("*")
          .eq("id", id)
          .single();
        if (rowErr || !row) {
          skipped.push({ name: id, reason: "not found or you don't have access to it" });
          continue;
        }
        if (row.size_bytes && row.size_bytes > MAX_SINGLE_FILE_BYTES) {
          skipped.push({
            name: row.file_name,
            reason: `file is ${(row.size_bytes / 1024 / 1024).toFixed(1)}MB — over the ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB single-file limit for direct AI reading`,
          });
          continue;
        }
        const { data: fileBlob, error: dlErr } = await supabase.storage
          .from("evidence")
          .download(row.storage_path);
        if (dlErr || !fileBlob) {
          skipped.push({ name: row.file_name, reason: "could not be downloaded from storage" });
          continue;
        }
        const buf = new Uint8Array(await fileBlob.arrayBuffer());
        if (totalRaw + buf.byteLength > MAX_TOTAL_RAW_BYTES) {
          skipped.push({
            name: row.file_name,
            reason: `combined evidence for this request already reached the ${MAX_TOTAL_RAW_BYTES / 1024 / 1024}MB cap — analyze this document in a separate request`,
          });
          continue;
        }
        const mime = guessMime(row.file_name, row.mime_type);
        if (mime === "application/pdf") {
          totalRaw += buf.byteLength;
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: encodeBase64(buf) },
            title: row.file_name,
          } as Anthropic.Messages.DocumentBlockParam);
        } else if (mime.startsWith("image/")) {
          totalRaw += buf.byteLength;
          docBlocks.push({
            type: "image",
            source: { type: "base64", media_type: mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: encodeBase64(buf) },
          } as Anthropic.Messages.ImageBlockParam);
        } else if (mime.startsWith("text/") || /\.(csv|txt)$/i.test(row.file_name)) {
          totalRaw += buf.byteLength;
          const text = new TextDecoder().decode(buf);
          docBlocks.push({ type: "text", text: `--- Document: ${row.file_name} ---\n${text}\n--- end of ${row.file_name} ---` });
        } else {
          skipped.push({
            name: row.file_name,
            reason: `file type (${mime}) can't be read directly by the AI — supported types are PDF, images (PNG/JPEG/GIF/WEBP), and text/CSV`,
          });
        }
      }
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: docBlocks.length ? 4000 : 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...docBlocks,
            {
              type: "text",
              text: `Engagement context (JSON):\n${JSON.stringify(context ?? {}, null, 1)}\n\n${docBlocks.length ? `${docBlocks.length} source document(s) are attached above — read every page of each in full before answering.\n\n` : ""}Question: ${question}`,
            },
          ],
        },
      ],
    });

    const answer = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    return json({ answer, skipped, documentsRead: docBlocks.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
