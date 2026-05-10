import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskScheduler } from "../scheduler.js";
import { InMemoryTaskStorage } from "../storage/memory.js";
import type { TaskExecutor, ScheduledTask, TaskRun } from "../types.js";

describe("TaskScheduler", () => {
  let storage: InMemoryTaskStorage;
  let executedTasks: { task: ScheduledTask; run: TaskRun }[];
  let executor: TaskExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 30, 0));

    storage = new InMemoryTaskStorage();
    executedTasks = [];
    executor = async (task, run) => {
      executedTasks.push({ task, run });
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("lifecycle", () => {
    it("should start and stop", () => {
      const scheduler = new TaskScheduler({
        storage,
        executor,
      });

      expect(scheduler.isRunning()).toBe(false);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("should not start twice", () => {
      const scheduler = new TaskScheduler({
        storage,
        executor,
      });

      scheduler.start();
      scheduler.start(); // Should be a no-op

      expect(scheduler.isRunning()).toBe(true);
      scheduler.stop();
    });
  });

  describe("task execution", () => {
    it("should run a task manually", async () => {
      const task = await storage.createTask({
        name: "Test Task",
        cronSchedule: "0 9 * * *",
        metadata: { prompt: "Do something" },
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      const run = await scheduler.runTaskNow(task.id);

      expect(run.status).toBe("success");
      expect(run.taskId).toBe(task.id);
      expect(executedTasks).toHaveLength(1);
      expect(executedTasks[0]!.task.name).toBe("Test Task");
    });

    it("should throw when running non-existent task", async () => {
      const scheduler = new TaskScheduler({
        storage,
        executor,
      });

      await expect(scheduler.runTaskNow("non-existent")).rejects.toThrow(
        "Task not found"
      );
    });

    it("should record run status on success", async () => {
      const task = await storage.createTask({
        name: "Test Task",
        cronSchedule: "0 9 * * *",
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      await scheduler.runTaskNow(task.id);

      const history = await storage.getRunHistory(task.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("success");
      expect(history[0]!.completedAt).toBeDefined();
    });

    it("should record run status on error", async () => {
      const task = await storage.createTask({
        name: "Test Task",
        cronSchedule: "0 9 * * *",
      });

      const failingExecutor: TaskExecutor = async () => {
        throw new Error("Task failed!");
      };

      const scheduler = new TaskScheduler({
        storage,
        executor: failingExecutor,
        webhooksEnabled: false,
      });

      const run = await scheduler.runTaskNow(task.id);

      expect(run.status).toBe("error");
      expect(run.error).toBe("Task failed!");

      const history = await storage.getRunHistory(task.id);
      expect(history[0]!.status).toBe("error");
      expect(history[0]!.error).toBe("Task failed!");
    });

    it("should update lastRunAt on task", async () => {
      const task = await storage.createTask({
        name: "Test Task",
        cronSchedule: "0 9 * * *",
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      await scheduler.runTaskNow(task.id);

      const updated = await storage.getTask(task.id);
      expect(updated!.lastRunAt).toBeDefined();
    });
  });

  describe("scheduling", () => {
    it("should run due tasks on checkNow", async () => {
      // Create task with lastRunAt in the past so it's ready to run again
      const task = await storage.createTask({
        name: "Every Minute",
        cronSchedule: "* * * * *",
      });
      // Set lastRunAt to 2 minutes ago
      await storage.updateLastRunAt(task.id, new Date(2024, 0, 15, 10, 28, 0));

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      // At 10:30, next run from 10:28 should be 10:29 or 10:30, which has passed
      await scheduler.checkNow();

      expect(executedTasks).toHaveLength(1);
    });

    it("should not run disabled tasks", async () => {
      const task = await storage.createTask({
        name: "Disabled Task",
        cronSchedule: "* * * * *",
        enabled: false,
      });
      await storage.updateLastRunAt(task.id, new Date(2024, 0, 15, 10, 28, 0));

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      await scheduler.checkNow();

      expect(executedTasks).toHaveLength(0);
    });

    it("should not run task twice for same scheduled time", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });
      // Last ran at 10:28
      await storage.updateLastRunAt(task.id, new Date(2024, 0, 15, 10, 28, 0));

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      // First check - should run (next after 10:28 is 10:29, now is 10:30)
      await scheduler.checkNow();
      expect(executedTasks).toHaveLength(1);

      // Second check immediately - should NOT run again (just ran)
      await scheduler.checkNow();
      expect(executedTasks).toHaveLength(1);
    });

    it("should track last run time in memory", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });
      await storage.updateLastRunAt(task.id, new Date(2024, 0, 15, 10, 28, 0));

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      expect(scheduler.getLastRunTime(task.id)).toBeUndefined();

      await scheduler.checkNow();

      expect(scheduler.getLastRunTime(task.id)).toBeDefined();
    });

    it("should call onError for failed tasks during check", async () => {
      const errors: { task: ScheduledTask; error: Error }[] = [];
      let resolveError: () => void;
      const errorPromise = new Promise<void>((resolve) => {
        resolveError = resolve;
      });

      const task = await storage.createTask({
        name: "Failing Task",
        cronSchedule: "* * * * *",
      });
      await storage.updateLastRunAt(task.id, new Date(2024, 0, 15, 10, 28, 0));

      const failingExecutor: TaskExecutor = async () => {
        throw new Error("Boom!");
      };

      const scheduler = new TaskScheduler({
        storage,
        executor: failingExecutor,
        webhooksEnabled: false,
        onError: (task, error) => {
          errors.push({ task, error });
          resolveError();
        },
      });

      await scheduler.checkNow();

      // Wait for the async error handler to be called
      await errorPromise;

      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toBe("Boom!");
    });
  });

  describe("polling", () => {
    it("should poll at configured interval", async () => {
      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "* * * * *",
      });
      // Set last run to 2 minutes ago so it's due
      await storage.updateLastRunAt(task.id, new Date(2024, 0, 15, 10, 28, 0));

      const scheduler = new TaskScheduler({
        storage,
        executor,
        pollIntervalMs: 1000, // 1 second for testing
        webhooksEnabled: false,
      });

      scheduler.start();
      
      // Advance timers to trigger interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(executedTasks).toHaveLength(1);

      scheduler.stop();
    });
  });

  describe("webhooks", () => {
    it("should fire webhooks on success when enabled", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock;

      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "0 9 * * *",
        webhooks: [{ url: "https://example.com/hook", events: ["success"] }],
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: true,
      });

      const run = await scheduler.runTaskNow(task.id);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/hook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );

      expect(run.webhookResults).toHaveLength(1);
      expect(run.webhookResults![0]!.status).toBe("success");
    });

    it("should not fire webhooks when disabled", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "0 9 * * *",
        webhooks: [{ url: "https://example.com/hook", events: ["success"] }],
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: false,
      });

      await scheduler.runTaskNow(task.id);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should fire webhooks on error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock;

      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "0 9 * * *",
        webhooks: [{ url: "https://example.com/hook", events: ["error"] }],
      });

      const failingExecutor: TaskExecutor = async () => {
        throw new Error("Failed!");
      };

      const scheduler = new TaskScheduler({
        storage,
        executor: failingExecutor,
        webhooksEnabled: true,
      });

      await scheduler.runTaskNow(task.id);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should fire webhooks on complete (both success and error)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock;

      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "0 9 * * *",
        webhooks: [{ url: "https://example.com/hook", events: ["complete"] }],
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: true,
      });

      await scheduler.runTaskNow(task.id);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should handle webhook errors gracefully", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = fetchMock;

      const task = await storage.createTask({
        name: "Test",
        cronSchedule: "0 9 * * *",
        webhooks: [{ url: "https://example.com/hook", events: ["success"] }],
      });

      const scheduler = new TaskScheduler({
        storage,
        executor,
        webhooksEnabled: true,
      });

      const run = await scheduler.runTaskNow(task.id);

      // Task should still succeed even if webhook fails
      expect(run.status).toBe("success");
      expect(run.webhookResults![0]!.status).toBe("error");
      expect(run.webhookResults![0]!.error).toBe("Network error");
    });
  });
});
