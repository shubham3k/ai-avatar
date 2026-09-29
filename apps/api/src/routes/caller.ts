import { DEMO_USER_EMAIL } from "../demo/demo-scenario.js";
import { validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * The single local user (the desktop app is single-user): an explicit
 * x-user-id header, else the bootstrap demo user.
 */
export async function resolveCallerId(request: { headers: Record<string, unknown> }): Promise<string | null> {
  const header = request.headers["x-user-id"];
  const callerId = typeof header === "string" ? header.trim() : "";
  if (callerId) return callerId;
  const demoUser = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, select: { id: true } });
  return demoUser?.id ?? null;
}

export async function requireCaller(request: { headers: Record<string, unknown> }): Promise<string> {
  const callerId = await resolveCallerId(request);
  if (!callerId) throw validationError("No local user is available yet.");
  return callerId;
}
