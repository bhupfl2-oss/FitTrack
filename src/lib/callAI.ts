import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type ContentPart = { text?: string; inlineData?: { mimeType: string; data: string } };
// A single turn in a multi-turn conversation — Gemini's Content shape.
export type ContentTurn = { role: "user" | "model"; parts: ContentPart[] };

interface CallAIRequest {
  model: string;
  systemInstruction?: string;
  // string | ContentPart[]: single-shot (optionally multimodal) generation.
  // ContentTurn[]: multi-turn chat history.
  contents: string | ContentPart[] | ContentTurn[];
  maxTokens: number;
  // Pass 0 to disable Gemini's "thinking" tokens for this call — recommended
  // for small maxTokens budgets (chat replies), where hidden reasoning tokens
  // can consume most of the budget and truncate the visible answer. Omit to
  // leave the model's default thinking behavior (recommended for large
  // structured-JSON generations, where thinking helps).
  thinkingBudget?: number;
}

interface CallAIResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

const callAIFn = httpsCallable<CallAIRequest, CallAIResponse>(functions, "callAI");

export async function callAI(request: CallAIRequest): Promise<CallAIResponse> {
  const result = await callAIFn(request);
  return result.data;
}
