import { describe, expect, it, vi } from "vitest";
import type { Goal } from "@prisma/client";
import { createGoalsService } from "./goals.service.js";
import type { GoalsRepository } from "../db/repositories/goals.repository.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_1",
    userId: "user_1",
    title: "Launch my product",
    description: null,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeGoalsRepo(overrides: Partial<GoalsRepository> = {}): GoalsRepository {
  return {
    create: vi.fn().mockResolvedValue(makeGoal()),
    listAll: vi.fn().mockResolvedValue([makeGoal()]),
    listActive: vi.fn().mockResolvedValue([makeGoal()]),
    findById: vi.fn().mockResolvedValue(makeGoal()),
    update: vi.fn().mockResolvedValue(makeGoal({ title: "Updated" })),
    ...overrides,
  };
}

describe("goals service", () => {
  it("creates a goal with a trimmed title", async () => {
    const goals = makeGoalsRepo();
    const service = createGoalsService({ goals });

    await service.createGoal("user_1", { title: "  Launch my product  " });

    expect(goals.create).toHaveBeenCalledWith({
      userId: "user_1",
      title: "Launch my product",
      description: null,
    });
  });

  it("rejects an empty/whitespace-only title", async () => {
    const service = createGoalsService({ goals: makeGoalsRepo() });

    await expect(service.createGoal("user_1", { title: "   " })).rejects.toThrow(
      /title is required/i,
    );
  });

  it("rejects a title over the max length", async () => {
    const service = createGoalsService({ goals: makeGoalsRepo() });

    await expect(
      service.createGoal("user_1", { title: "x".repeat(201) }),
    ).rejects.toThrow(/200 characters/);
  });

  it("rejects a description over the max length", async () => {
    const service = createGoalsService({ goals: makeGoalsRepo() });

    await expect(
      service.createGoal("user_1", { title: "ok", description: "x".repeat(2001) }),
    ).rejects.toThrow(/2000 characters/);
  });

  it("normalizes an empty-string description to null", async () => {
    const goals = makeGoalsRepo();
    const service = createGoalsService({ goals });

    await service.createGoal("user_1", { title: "ok", description: "   " });

    expect(goals.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
    );
  });

  it("lists only active goals by default", async () => {
    const goals = makeGoalsRepo();
    const service = createGoalsService({ goals });

    await service.listGoals("user_1", false);

    expect(goals.listActive).toHaveBeenCalledWith("user_1");
    expect(goals.listAll).not.toHaveBeenCalled();
  });

  it("lists all goals when includeInactive is true", async () => {
    const goals = makeGoalsRepo();
    const service = createGoalsService({ goals });

    await service.listGoals("user_1", true);

    expect(goals.listAll).toHaveBeenCalledWith("user_1");
    expect(goals.listActive).not.toHaveBeenCalled();
  });

  it("updates a goal (e.g. deactivating it)", async () => {
    const goals = makeGoalsRepo();
    const service = createGoalsService({ goals });

    await service.updateGoal("user_1", "goal_1", { active: false });

    expect(goals.update).toHaveBeenCalledWith("user_1", "goal_1", { active: false });
  });

  it("throws not_found when updating a goal that doesn't exist (or isn't this user's)", async () => {
    const goals = makeGoalsRepo({ update: vi.fn().mockResolvedValue(null) });
    const service = createGoalsService({ goals });

    await expect(
      service.updateGoal("user_1", "missing", { active: false }),
    ).rejects.toThrow(/not found/i);
  });

  it("validates title/description on update the same way as create", async () => {
    const service = createGoalsService({ goals: makeGoalsRepo() });

    await expect(
      service.updateGoal("user_1", "goal_1", { title: "   " }),
    ).rejects.toThrow(/title is required/i);
  });
});
