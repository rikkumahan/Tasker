import { prePassRedact } from "./pii.ts";
import { callLLM } from "./llm.ts";
import { getEmbedding } from "./graph.ts";

export interface ActionContextInput {
  userId: string;
  threadId: string;
  gmailThreadId: string;
  senderEmail?: string;
  emailEmbedding: number[];
}

export interface ActionCandidate {
  description?: string;
  task?: string;
  assigned_to?: string;
  assignee?: string;
  deadline?: string | null;
  direction?: "inbox" | "sent" | "unknown";
  confidence?: number;
  operation?: "create" | "update" | "duplicate" | "ignore";
  existing_action_id?: string;
  evidence?: unknown;
}

export interface ExtractedActionPayload {
  urgency?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  action_type?: "view" | "reply" | "review" | "approve" | "join";
  ai_summary?: string;
  suggested_reply?: string;
  action_items?: ActionCandidate[];
}

const ACTION_MODEL = "llama-3.1-8b-instant";

const compactRows = (rows: unknown[], limit = 8) => Array.isArray(rows) ? rows.slice(0, limit) : [];

const parseJsonObject = (text: string): ExtractedActionPayload | null => {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

export class ActionContextBuilder {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async build(input: ActionContextInput) {
    const [
      threadContext,
      senderContext,
      similarEmails,
      graphContext,
      similarActions,
    ] = await Promise.all([
      this.supabase.rpc("get_thread_context", {
        p_user_id: input.userId,
        p_thread_id: input.threadId,
        p_gmail_thread_id: input.gmailThreadId,
        limit_count: 12,
      }),
      this.supabase.rpc("get_sender_context", {
        p_user_id: input.userId,
        p_sender_email: input.senderEmail || null,
        limit_count: 8,
      }),
      this.supabase.rpc("match_emails", {
        p_user_id: input.userId,
        query_embedding: input.emailEmbedding,
        match_threshold: 0.25,
        match_count: 8,
      }),
      this.supabase.rpc("get_related_graph_context", {
        p_user_id: input.userId,
        p_thread_id: input.threadId,
        max_results: 16,
      }),
      this.supabase.rpc("match_action_items", {
        p_user_id: input.userId,
        query_embedding: input.emailEmbedding,
        match_threshold: 0.65,
        match_count: 8,
      }),
    ]);

    return {
      thread_context: compactRows(threadContext.data || []),
      sender_context: compactRows(senderContext.data || []),
      similar_emails: compactRows(similarEmails.data || []),
      graph_context: compactRows(graphContext.data || [], 16),
      similar_actions: compactRows(similarActions.data || []),
      retrieval_errors: [
        threadContext.error?.message,
        senderContext.error?.message,
        similarEmails.error?.message,
        graphContext.error?.message,
        similarActions.error?.message,
      ].filter(Boolean),
    };
  }
}

export class ActionExtractor {
  async extract(emailBody: string, emailSubject: string, contextPack: unknown): Promise<ExtractedActionPayload | null> {
    const redactedText = prePassRedact(`Subject: ${emailSubject}\nBody: ${emailBody}`);
    const contextJson = JSON.stringify(contextPack, null, 2).slice(0, 12000);

    const prompt = `You are an AI executive assistant inside a production email intelligence system.
Use the email and the retrieved evidence pack to produce action candidates.
Return ONLY valid JSON. Do not include markdown, prose, or comments.

Rules:
- Create actions only for concrete commitments, requests, follow-ups, approvals, reviews, deadlines, or meetings.
- If the email merely informs or advertises, return an empty action_items array.
- Use retrieved similar_actions to update or duplicate existing actions instead of creating repeats.
- Never invent people, dates, or commitments not supported by the email/evidence.
- Set confidence from 0 to 1 based on evidence strength.

JSON schema:
{
  "urgency": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  "action_type": "view" | "reply" | "review" | "approve" | "join",
  "ai_summary": "1-2 sentence summary",
  "action_items": [
    {
      "description": "Concrete action",
      "assigned_to": "person or null",
      "deadline": "ISO8601 or null",
      "direction": "inbox" | "sent" | "unknown",
      "confidence": 0.0,
      "operation": "create" | "update" | "duplicate" | "ignore",
      "existing_action_id": "uuid when operation is update/duplicate, else null"
    }
  ],
  "suggested_reply": "Draft reply text, or empty string"
}

EMAIL:
${redactedText}

RETRIEVED EVIDENCE PACK:
${contextJson}

OUTPUT JSON:`;

    const responseText = await callLLM(prompt, {
      model: ACTION_MODEL,
      temperature: 0.1,
      jsonFormat: true,
    });

    if (!responseText) return null;
    return parseJsonObject(responseText);
  }
}

export class ActionReconciler {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async reconcile(params: {
    userId: string;
    threadId: string;
    emailId: string;
    gmailThreadId: string;
    candidates: ActionCandidate[];
    contextPack: unknown;
  }) {
    const results: any[] = [];

    for (const candidate of params.candidates || []) {
      const description = (candidate.description || candidate.task || "").trim();
      const confidence = Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.75)));
      const operation = candidate.operation || "create";

      if (!description || confidence < 0.35 || operation === "ignore") {
        results.push({ operation: "ignored", description, reason: "low-confidence-or-empty" });
        continue;
      }

      const embedding = await getEmbedding(description);
      const assignedTo = candidate.assigned_to || candidate.assignee || null;
      const deadline = candidate.deadline || null;
      const direction = candidate.direction || "unknown";

      const { data: duplicateRows } = await this.supabase.rpc("check_duplicate_action_item", {
        p_user_id: params.userId,
        task_vector: embedding,
        sim_threshold: 0.92,
      });
      const duplicate = duplicateRows?.[0] || null;
      const targetActionId = candidate.existing_action_id || duplicate?.id || null;

      const evidence = {
        source: "live_action_extraction",
        thread_id: params.threadId,
        gmail_thread_id: params.gmailThreadId,
        email_id: params.emailId,
        model_operation: operation,
        candidate_evidence: candidate.evidence ?? null,
        context_pack: contextPack,
      };

      if (operation === "duplicate") {
        if (!targetActionId) {
          results.push({ operation: "ignored", description, reason: "duplicate-without-match" });
          continue;
        }

        const duplicateResult = await this.insertDuplicate(
          params,
          description,
          direction,
          assignedTo,
          deadline,
          embedding,
          confidence,
          targetActionId,
          evidence,
        );
        results.push(duplicateResult);
        continue;
      }

      if (operation === "update" && targetActionId) {
        results.push(await this.updateAction(targetActionId, params.userId, {
          description,
          status: "pending",
          confidence,
          embedding,
          deadline,
          assignedTo,
          evidence,
        }));
        continue;
      }

      if (duplicate?.id) {
        if (duplicate.status === "candidate") {
          results.push(await this.updateAction(duplicate.id, params.userId, {
            description,
            status: "pending",
            confidence,
            embedding,
            deadline,
            assignedTo,
            evidence,
          }, "promoted"));
        } else {
          results.push(await this.dedupeExisting(duplicate.id, params.userId, deadline, assignedTo, evidence));
        }
        continue;
      }

      results.push(await this.createAction(
        params,
        description,
        direction,
        assignedTo,
        deadline,
        embedding,
        confidence,
        evidence,
      ));
    }

    await this.supabase.rpc("refresh_thread_action_projection", {
      p_user_id: params.userId,
      p_thread_id: params.threadId,
    });

    return results;
  }

  private async updateAction(
    actionId: string,
    userId: string,
    input: {
      description: string;
      status: "pending";
      confidence: number;
      embedding: number[];
      deadline: string | null;
      assignedTo: string | null;
      evidence: unknown;
    },
    successOperation = "updated",
  ) {
    const updatePayload: Record<string, unknown> = {
      description: input.description,
      status: input.status,
      confidence: input.confidence,
      embedding: input.embedding,
      evidence: input.evidence,
      updated_at: new Date().toISOString(),
    };
    if (input.deadline) updatePayload.deadline = input.deadline;
    if (input.assignedTo) updatePayload.assigned_to = input.assignedTo;

    const { data, error } = await this.supabase
      .from("action_items")
      .update(updatePayload)
      .eq("id", actionId)
      .eq("user_id", userId)
      .select("id, status, description")
      .single();

    if (error) {
      return { operation: `${successOperation}_failed`, description: input.description, error: error.message };
    }
    return { operation: successOperation, action: data };
  }

  private async dedupeExisting(
    actionId: string,
    userId: string,
    deadline: string | null,
    assignedTo: string | null,
    evidence: unknown,
  ) {
    const updatePayload: Record<string, unknown> = {
      evidence,
      updated_at: new Date().toISOString(),
    };
    if (deadline) updatePayload.deadline = deadline;
    if (assignedTo) updatePayload.assigned_to = assignedTo;

    const { data, error } = await this.supabase
      .from("action_items")
      .update(updatePayload)
      .eq("id", actionId)
      .eq("user_id", userId)
      .select("id, status, description")
      .single();

    if (error) {
      return { operation: "dedupe_failed", error: error.message };
    }
    return { operation: "deduped", action: data };
  }

  private async createAction(
    params: { userId: string; threadId: string; emailId: string },
    description: string,
    direction: string,
    assignedTo: string | null,
    deadline: string | null,
    embedding: number[],
    confidence: number,
    evidence: unknown,
  ) {
    const { data, error } = await this.supabase
      .from("action_items")
      .insert({
        user_id: params.userId,
        thread_id: params.threadId,
        email_id: params.emailId,
        description,
        status: "pending",
        direction,
        assigned_to: assignedTo,
        deadline,
        embedding,
        confidence,
        evidence,
      })
      .select("id, status, description")
      .single();

    if (error) {
      return { operation: "create_failed", description, error: error.message };
    }
    return { operation: "created", action: data };
  }

  private async insertDuplicate(
    params: { userId: string; threadId: string; emailId: string },
    description: string,
    direction: string,
    assignedTo: string | null,
    deadline: string | null,
    embedding: number[],
    confidence: number,
    duplicateId: string,
    evidence: unknown,
  ) {
    const { data, error } = await this.supabase.from("action_items").insert({
      user_id: params.userId,
      thread_id: params.threadId,
      email_id: params.emailId,
      description,
      status: "duplicate",
      direction,
      assigned_to: assignedTo,
      deadline,
      embedding,
      confidence,
      duplicate_of: duplicateId,
      evidence,
    }).select("id, status, description, duplicate_of").single();

    if (error) {
      return { operation: "duplicate_failed", description, error: error.message };
    }
    return { operation: "duplicated", action: data };
  }
}
