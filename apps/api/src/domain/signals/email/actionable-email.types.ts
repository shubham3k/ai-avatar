export type ActionableConfidence = "high" | "medium";

export interface ActionableEmailInput {
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  isRead: boolean;
  labels: string[];
  receivedAt: Date | null;
}

export interface ActionableEmailResult {
  actionable: boolean;
  confidence: ActionableConfidence | null;
  reason: string;
  matchedRules: string[];
}
