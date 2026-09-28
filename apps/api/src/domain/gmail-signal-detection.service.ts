import {
  createEmailsRepository,
  type EmailsRepository,
} from "../db/repositories/emails.repository.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
  type InterventionsRepository,
  type SignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { prisma } from "../lib/prisma.js";
import { GENERIC_EMAIL_RULE_ID } from "./signals/email/actionable-email.rules.js";
import { detectActionableEmail } from "./signals/email/actionable-email.detector.js";
import type { ActionableConfidence } from "./signals/email/actionable-email.types.js";

export const SIGNAL_DETECTION_DEFAULT_LIMIT = 10;
export const SIGNAL_DETECTION_MAX_LIMIT = 25;

export interface GmailSignalDetectionResult {
  analyzed: number;
  actionable: number;
  signalsCreated: number;
  interventionsCreated: number;
}

export function clampDetectionLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return SIGNAL_DETECTION_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(requested), SIGNAL_DETECTION_MAX_LIMIT));
}

const AVAILABLE_ACTIONS = ["DONE", "REMIND_LATER"];

function priorityFor(confidence: ActionableConfidence): "high" | "medium" {
  return confidence === "high" ? "high" : "medium";
}

function titleFor(fromName: string | null, fromEmail: string, matchedRules: string[]): string {
  const who = fromName?.trim() || fromEmail.split("@")[0]?.trim() || "Someone";
  const isGeneric = matchedRules.length === 1 && matchedRules[0] === GENERIC_EMAIL_RULE_ID;
  return isGeneric ? `New email from ${who}` : `${who} needs your response`;
}

export function createGmailSignalDetectionService(dependencies?: {
  emails?: EmailsRepository;
  signals?: SignalsRepository;
  interventions?: InterventionsRepository;
}) {
  const emails = dependencies?.emails ?? createEmailsRepository(prisma);
  const signals = dependencies?.signals ?? createSignalsRepository(prisma);
  const interventions =
    dependencies?.interventions ?? createInterventionsRepository(prisma);

  return {
    async detectAndCreateInterventions(
      userId: string,
      requestedLimit?: number,
      now: Date = new Date(),
    ): Promise<GmailSignalDetectionResult> {
      const limit = clampDetectionLimit(requestedLimit);
      const recentEmails = await emails.listRecent(userId, limit);

      let actionableCount = 0;
      let signalsCreated = 0;
      let interventionsCreated = 0;

      for (const email of recentEmails) {
        const detection = detectActionableEmail(
          {
            fromEmail: email.fromEmail,
            fromName: email.fromName,
            subject: email.subject,
            snippet: email.snippet,
            isRead: email.isRead,
            labels: email.labels,
            receivedAt: email.receivedAt,
          },
          now,
        );

        if (!detection.actionable || !detection.confidence) continue;
        actionableCount += 1;

        let signal = await signals.findUniqueKey(
          userId,
          "user_action_required",
          "email",
          email.id,
        );
        if (!signal) {
          signal = await signals.create({
            userId,
            type: "user_action_required",
            sourceType: "email",
            sourceId: email.id,
            title: titleFor(email.fromName, email.fromEmail, detection.matchedRules),
            summary: detection.reason,
            dueAt: null,
            importanceHints: {
              matchedRules: detection.matchedRules,
              confidence: detection.confidence,
              emailId: email.id,
              providerMessageId: email.providerMessageId,
            },
          });
          signalsCreated += 1;
        }

        const existingIntervention = await interventions.findBySignalId(signal.id);
        if (!existingIntervention) {
          await interventions.create({
            userId,
            signalId: signal.id,
            priority: priorityFor(detection.confidence),
            title: titleFor(email.fromName, email.fromEmail, detection.matchedRules),
            message: detection.reason,
            reason: detection.reason,
            actionType: "open_source",
            actionPayload: {
              sourceUrl: email.sourceUrl,
              availableActions: AVAILABLE_ACTIONS,
            },
          });
          interventionsCreated += 1;
        }
      }

      return {
        analyzed: recentEmails.length,
        actionable: actionableCount,
        signalsCreated,
        interventionsCreated,
      };
    },
  };
}

export type GmailSignalDetectionService = ReturnType<
  typeof createGmailSignalDetectionService
>;
