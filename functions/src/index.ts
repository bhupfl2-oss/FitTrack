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
