import { DEMO_USER_EMAIL, ensureDemoData } from "../demo/demo-scenario.js";
import {
  createInterventionsRepository,
  createSignalsRepository,
} from "../db/repositories/interventions.repository.js";
import { prisma } from "../lib/prisma.js";
import { evaluateApprovalScenario } from "./signal-engine.js";

export interface DemoPipelineResult {
  signalCreated: boolean;
  interventionCreated: boolean;
  signalId: string | null;
  interventionId: string | null;
}

const INTERVENTION_TITLE = "Design team is waiting for your feedback";
const INTERVENTION_MESSAGE =
  "The design team is waiting for your feedback. The launch is tomorrow.";
const AVAILABLE_ACTIONS = ["DONE", "REMIND_LATER"];

export function createDemoPipelineService(now: Date = new Date()) {
  const signals = createSignalsRepository(prisma);
  const interventions = createInterventionsRepository(prisma);

  return {
    async run(): Promise<DemoPipelineResult> {
      const demo = await ensureDemoData(prisma, now);

      const emailRecord = await prisma.email.findUnique({
        where: { id: demo.email.id },
      });
      const eventRecord = await prisma.calendarEvent.findUnique({
        where: { id: demo.calendarEvent.id },
      });
      if (!emailRecord || !eventRecord) {
        throw new Error("Demo data missing after seeding");
      }

      const candidate = evaluateApprovalScenario(
        {
          email: {
            fromEmail: emailRecord.fromEmail,
            subject: emailRecord.subject,
            bodyText: emailRecord.bodyText,
            snippet: emailRecord.snippet,
          },
          userIsSender: emailRecord.fromEmail === DEMO_USER_EMAIL,
          calendarEvent: {
            title: eventRecord.title,
            startAt: eventRecord.startAt,
          },
        },
        now,
      );

      if (!candidate) {
        return {
          signalCreated: false,
          interventionCreated: false,
          signalId: null,
          interventionId: null,
        };
      }

      let signal = await signals.findUniqueKey(
        demo.user.id,
        candidate.type,
        candidate.sourceType,
        emailRecord.id,
      );
      let signalCreated = false;
      if (!signal) {
        signal = await signals.create({
          userId: demo.user.id,
          type: candidate.type,
          sourceType: candidate.sourceType,
          sourceId: emailRecord.id,
          title: candidate.title,
          summary: candidate.summary,
          dueAt: candidate.dueAt,
          importanceHints: candidate.importanceHints,
        });
        signalCreated = true;
      }

      let interventionCreated = false;
      let intervention = await interventions.findBySignalId(signal.id);
      if (!intervention) {
        intervention = await interventions.create({
          userId: demo.user.id,
          signalId: signal.id,
          priority: "high",
          title: INTERVENTION_TITLE,
          message: INTERVENTION_MESSAGE,
          reason: candidate.reason,
          actionType: "none",
          actionPayload: { availableActions: AVAILABLE_ACTIONS },
        });
        interventionCreated = true;
      }

      return {
        signalCreated,
        interventionCreated,
        signalId: signal.id,
        interventionId: intervention.id,
      };
    },
  };
}
