import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = defineSecret("GEMINI_API_KEY");

type ContentPart = { text?: string; inlineData?: { mimeType: string; data: string } };
// A single turn in a multi-turn conversation — Gemini's Content shape.
type ContentTurn = { role: "user" | "model"; parts: ContentPart[] };

interface CallAIRequest {
  model: string;
  systemInstruction?: string;
  // string | ContentPart[]: single-shot (optionally multimodal) generation.
  // ContentTurn[]: multi-turn chat history, passed straight through to the
  // Gemini SDK's generateContent, which accepts Content[] natively.
  contents: string | ContentPart[] | ContentTurn[];
  maxTokens: number;
  // Gemini 2.5+ "thinking" models spend part of maxOutputTokens on hidden
  // reasoning tokens before writing the visible answer — at small maxTokens
  // budgets (chat replies) this can consume nearly the whole budget and
  // truncate the visible text. Pass 0 to disable thinking for a call;
  // omit to leave the model's default (recommended for large structured-JSON
  // generations, where thinking helps and the budget is large enough to absorb it).
  thinkingBudget?: number;
}

interface CallAIResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ── Model pin policy ─────────────────────────────────────────────────────────
// `model` is supplied by each client call site (grep the client codebase for
// "gemini-3.5-flash" / "gemini-3.1-flash-lite"), NOT hardcoded here — this
// function just forwards whatever model string it's given to Gemini. That
// means there is no single source of truth for the pin; every call site
// must be updated together.
//
// Currently pinned (as of 2026-07-23, after the 2026-07-21 Gemini 3.6 Flash /
// 3.5 Flash-Lite rollout broke every `-latest` alias with a 400
// INVALID_ARGUMENT — do NOT go back to `-latest` aliases):
//   - flash tier (plan generation, chat):      gemini-3.5-flash
//   - flash-lite tier (simple insights):        gemini-3.1-flash-lite
//
// Before ever changing either pin: test the candidate model directly against
// BOTH request shapes this function supports — a `thinkingBudget: 0` call
// (chat/insight sites) AND a thinking-enabled call with no thinkingBudget set
// (plan generation sites) — since a new model generation can break one shape
// without the other. Never pin to a `-latest`/undated alias again.
export const callAI = onCall<CallAIRequest>(
  { secrets: [geminiApiKey] },
  async (request): Promise<CallAIResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to use this feature.");
    }

    const { model, systemInstruction, contents, maxTokens, thinkingBudget } = request.data ?? ({} as CallAIRequest);

    if (!model || typeof model !== "string") {
      throw new HttpsError("invalid-argument", "A valid 'model' string is required.");
    }
    if (!contents || (typeof contents !== "string" && !Array.isArray(contents))) {
      throw new HttpsError("invalid-argument", "'contents' must be a string or an array of content parts.");
    }
    if (!maxTokens || typeof maxTokens !== "number") {
      throw new HttpsError("invalid-argument", "A valid 'maxTokens' number is required.");
    }

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          maxOutputTokens: maxTokens,
          ...(typeof thinkingBudget === "number" ? { thinkingConfig: { thinkingBudget } } : {}),
        },
      });

      return {
        text: response.text ?? "",
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      console.error("callAI Gemini request failed:", err);
      throw new HttpsError("internal", "AI request failed. Please try again.");
    }
  }
);
