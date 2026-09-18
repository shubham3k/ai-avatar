import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// SQLite has no native enum support (Phase 4.1) — these were Prisma-generated
// enum types before; now plain string unions.
type Priority = "low" | "medium" | "high" | "critical";
type SignalType =
	| "user_action_required"
	| "reply_needed"
	| "approval_needed"
	| "deadline"
	| "upcoming_meeting"
	| "follow_up";

const fixtures: Array<{
	key: string;
	type: SignalType;
	priority: Priority;
	title: string;
	message: string;
	reason: string;
}> = [
	{
		key: "launch-blocker",
		type: "deadline",
		priority: "critical",
		title: "Launch checklist needs your decision",
		message: "The release checklist has one unresolved blocker. Review it before the launch window.",
		reason: "A critical decision is blocking the planned launch.",
	},
	{
		key: "budget-approval",
		type: "approval_needed",
		priority: "high",
		title: "Approve the Q4 campaign budget",
		message: "Finance is waiting for your approval on the proposed campaign budget.",
		reason: "An approval request is waiting for the account owner.",
	},
	{
		key: "team-follow-up",
		type: "follow_up",
		priority: "medium",
		title: "Follow up with the product team",
		message: "The product team has not received an answer to its planning question.",
		reason: "A follow-up is due from an open team conversation.",
	},
	{
		key: "weekly-review",
		type: "user_action_required",
		priority: "low",
		title: "Review this week's notes",
		message: "Your weekly notes are ready for a quick review when you have a moment.",
		reason: "A low-priority review task is available.",
	},
];

async function main() {
	const user = await prisma.user.upsert({
		where: { email: "demo@example.local" },
		update: {},
		create: {
			email: "demo@example.local",
			displayName: "Demo User",
			timezone: "UTC",
		},
	});

	for (const fixture of fixtures) {
		const sourceId = `desktop-fixture-${fixture.key}`;
		const signal = await prisma.signal.upsert({
			where: {
				userId_type_sourceType_sourceId: {
					userId: user.id,
					type: fixture.type,
					sourceType: "desktop_fixture",
					sourceId,
				},
			},
			update: {
				title: fixture.title,
				summary: fixture.message,
				status: "open",
			},
			create: {
				userId: user.id,
				type: fixture.type,
				sourceType: "desktop_fixture",
				sourceId,
				title: fixture.title,
				summary: fixture.message,
			},
		});

		await prisma.intervention.upsert({
			where: { signalId: signal.id },
			update: {
				status: "pending",
				priority: fixture.priority,
				title: fixture.title,
				message: fixture.message,
				reason: fixture.reason,
				resolvedAt: null,
				snoozedUntil: null,
			},
			create: {
				userId: user.id,
				signalId: signal.id,
				priority: fixture.priority,
				title: fixture.title,
				message: fixture.message,
				reason: fixture.reason,
				actionType: "none",
				actionPayload: JSON.stringify({ availableActions: ["DONE", "REMIND_LATER"] }),
			},
		});
	}

	console.log(`Created ${fixtures.length} desktop test interventions for ${user.email}.`);
	console.log("The desktop app shows them in priority order after each Done action.");
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
