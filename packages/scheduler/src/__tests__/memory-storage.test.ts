import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTaskStorage } from "../storage/memory.js";
import type { TaskRun } from "../types.js";

describe("InMemoryTaskStorage", () => {
  let storage: InMemoryTaskStorage;

  beforeEach(() => {
    storage = new InMemoryTaskStorage();
  });

  describe("task CRUD", () => {
    it("should create a task", async () => {
      const task = await storage.createTask({
        name: "Test Task",
        cronSchedule: "0 9 * * *",
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe("Test Task");
      expect(task.cronSchedule).toBe("0 9 * * *");
      expect(task.enabled).toBe(true);
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toBeInstanceOf(Date);
    });

    it("should create a task with custom id", async () => {
      const task = await storage.createTask({
        id: "custom-id",
        name: "Test Task",
        cronSchedule: "0 9 * * *",
      });

      expect(task.id).toBe("custom-id");
    });

    it("should create a task with all options", async () => {
      const task = await storage.createTask({
        name: "Full Task",
        cronSchedule: "0 9 * * *",
        enabled: false,
        metadata: { prompt: "Do something", projectId: "proj-1" },
        webhooks: [{ url: "https://example.com/hook", events: ["complete"] }],
      });

      expect(task.enabled).toBe(false);
      expect(task.metadata).toEqual({ prompt: "Do something", projectId: "proj-1" });
      expect(task.webhooks).toHaveLength(1);
    });

    it("should list tasks sorted by name", async () => {
      await storage.createTask({ name: "Zebra", cronSchedule: "* * * * *" });
      await storage.createTask({ name: "Apple", cronSchedule: "* * * * *" });
      await storage.createTask({ name: "Mango", cronSchedule: "* * * * *" });

      const tasks = await storage.listTasks();
      expect(tasks.map((t) => t.name)).toEqual(["Apple", "Mango", "Zebra"]);
    });

    it("should get a task by id", async () => {
      const created = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      const fetched = await storage.getTask(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe("Test");
    });

    it("should return null for non-existent task", async () => {
      const fetched = await storage.getTask("non-existent");
      expect(fetched).toBeNull();
    });

    it("should update a task", async () => {
      const task = await storage.createTask({
        name: "Original",
        cronSchedule: "0 9 * * *",
      });

      const updated = await storage.updateTask(task.id, {
        name: "Updated",
        cronSchedule: "0 10 * * *",
        enabled: false,
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Updated");
      expect(updated!.cronSchedule).toBe("0 10 * * *");
      expect(updated!.enabled).toBe(false);
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        task.updatedAt.getTime()
      );
    });

    it("should return null when updating non-existent task", async () => {
      const updated = await storage.updateTask("non-existent", { name: "New" });
      expect(updated).toBeNull();
    });

    it("should delete a task", async () => {
      const task = await storage.createTask({
        name: "ToDelete",
        cronSchedule: "* * * * *",
      });

      const deleted = await storage.deleteTask(task.id);
      expect(deleted).toBe(true);

      const fetched = await storage.getTask(task.id);
      expect(fetched).toBeNull();
    });

    it("should return false when deleting non-existent task", async () => {
      const deleted = await storage.deleteTask("non-existent");
      expect(deleted).toBe(false);
    });

    it("should update lastRunAt", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      expect(task.lastRunAt).toBeUndefined();

      const runTime = new Date();
      await storage.updateLastRunAt(task.id, runTime);

      const fetched = await storage.getTask(task.id);
      expect(fetched!.lastRunAt).toEqual(runTime);
    });
  });

  describe("run history", () => {
    it("should record a run", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      const run: TaskRun = {
        id: "run-1",
        taskId: task.id,
        startedAt: new Date(),
        status: "running",
      };

      await storage.recordRun(run);

      const history = await storage.getRunHistory(task.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.id).toBe("run-1");
    });

    it("should update a run", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      const run: TaskRun = {
        id: "run-1",
        taskId: task.id,
        startedAt: new Date(),
        status: "running",
      };

      await storage.recordRun(run);

      const completedAt = new Date();
      await storage.updateRun("run-1", {
        status: "success",
        completedAt,
        metadata: { output: "done" },
      });

      const history = await storage.getRunHistory(task.id);
      expect(history[0]!.status).toBe("success");
      expect(history[0]!.completedAt).toEqual(completedAt);
      expect(history[0]!.metadata).toEqual({ output: "done" });
    });

    it("should keep runs in most-recent-first order", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      await storage.recordRun({
        id: "run-1",
        taskId: task.id,
        startedAt: new Date(2024, 0, 1),
        status: "success",
      });

      await storage.recordRun({
        id: "run-2",
        taskId: task.id,
        startedAt: new Date(2024, 0, 2),
        status: "success",
      });

      const history = await storage.getRunHistory(task.id);
      expect(history[0]!.id).toBe("run-2");
      expect(history[1]!.id).toBe("run-1");
    });

    it("should limit run history", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      for (let i = 0; i < 10; i++) {
        await storage.recordRun({
          id: `run-${i}`,
          taskId: task.id,
          startedAt: new Date(),
          status: "success",
        });
      }

      const history = await storage.getRunHistory(task.id, 3);
      expect(history).toHaveLength(3);
    });

    it("should prune old runs when exceeding maxRunsPerTask", async () => {
      const storage = new InMemoryTaskStorage({ maxRunsPerTask: 5 });
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      for (let i = 0; i < 10; i++) {
        await storage.recordRun({
          id: `run-${i}`,
          taskId: task.id,
          startedAt: new Date(),
          status: "success",
        });
      }

      const history = await storage.getRunHistory(task.id);
      expect(history).toHaveLength(5);
      // Should have the most recent runs
      expect(history[0]!.id).toBe("run-9");
    });

    it("should delete runs when task is deleted", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      await storage.recordRun({
        id: "run-1",
        taskId: task.id,
        startedAt: new Date(),
        status: "success",
      });

      await storage.deleteTask(task.id);

      expect(storage.getRunCount()).toBe(0);
    });
  });

  describe("utility methods", () => {
    it("should clear all data", async () => {
      await storage.createTask({ name: "Test", cronSchedule: "* * * * *" });
      storage.clear();

      expect(storage.getTaskCount()).toBe(0);
      expect(storage.getRunCount()).toBe(0);
    });

    it("should count tasks and runs", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });

      await storage.recordRun({
        id: "run-1",
        taskId: task.id,
        startedAt: new Date(),
        status: "success",
      });

      expect(storage.getTaskCount()).toBe(1);
      expect(storage.getRunCount()).toBe(1);
    });
  });
});
