import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseNextRun, describeCron, isValidCron } from "../cron.js";

describe("cron", () => {
  describe("parseNextRun", () => {
    beforeEach(() => {
      // Mock Date to a fixed time: 2024-01-15 10:30:00
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 0, 15, 10, 30, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return null for invalid cron expressions", () => {
      expect(parseNextRun("")).toBeNull();
      expect(parseNextRun("* *")).toBeNull();
      expect(parseNextRun("* * * * * *")).toBeNull();
      expect(parseNextRun("invalid")).toBeNull();
    });

    it("should parse every minute (* * * * *)", () => {
      const next = parseNextRun("* * * * *");
      expect(next).not.toBeNull();
      // Should be the next minute (10:31)
      expect(next!.getHours()).toBe(10);
      expect(next!.getMinutes()).toBe(31);
    });

    it("should parse every 5 minutes (*/5 * * * *)", () => {
      const next = parseNextRun("*/5 * * * *");
      expect(next).not.toBeNull();
      // Next 5-minute mark after 10:30 is 10:35
      expect(next!.getHours()).toBe(10);
      expect(next!.getMinutes()).toBe(35);
    });

    it("should parse specific time (30 9 * * *)", () => {
      const next = parseNextRun("30 9 * * *");
      expect(next).not.toBeNull();
      // 9:30 already passed today, so should be tomorrow
      expect(next!.getDate()).toBe(16);
      expect(next!.getHours()).toBe(9);
      expect(next!.getMinutes()).toBe(30);
    });

    it("should parse specific time in the future today (0 14 * * *)", () => {
      const next = parseNextRun("0 14 * * *");
      expect(next).not.toBeNull();
      // 2:00 PM is later today
      expect(next!.getDate()).toBe(15);
      expect(next!.getHours()).toBe(14);
      expect(next!.getMinutes()).toBe(0);
    });

    it("should parse day of week (0 9 * * 1)", () => {
      const next = parseNextRun("0 9 * * 1");
      expect(next).not.toBeNull();
      // Jan 15, 2024 is Monday, 9am already passed, so next Monday
      expect(next!.getDay()).toBe(1); // Monday
    });

    it("should parse range (0 9-17 * * *)", () => {
      const next = parseNextRun("0 9-17 * * *");
      expect(next).not.toBeNull();
      // Should be 11:00 (next hour with minute 0)
      expect(next!.getHours()).toBe(11);
      expect(next!.getMinutes()).toBe(0);
    });

    it("should parse list (0 9,12,15 * * *)", () => {
      const next = parseNextRun("0 9,12,15 * * *");
      expect(next).not.toBeNull();
      // 9am passed, next is 12pm
      expect(next!.getHours()).toBe(12);
      expect(next!.getMinutes()).toBe(0);
    });
  });

  describe("describeCron", () => {
    it("should describe every hour", () => {
      expect(describeCron("0 * * * *")).toBe("Every hour");
    });

    it("should describe daily at specific time", () => {
      expect(describeCron("30 9 * * *")).toBe("Daily at 9:30 AM");
      expect(describeCron("0 14 * * *")).toBe("Daily at 2:00 PM");
      expect(describeCron("0 0 * * *")).toBe("Daily at 12:00 AM");
    });

    it("should describe weekly", () => {
      expect(describeCron("0 9 * * 1")).toBe("Every Monday at 9:00 AM");
      expect(describeCron("30 17 * * 5")).toBe("Every Friday at 5:30 PM");
    });

    it("should describe every N minutes", () => {
      expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
      expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    });

    it("should describe every N hours", () => {
      expect(describeCron("0 */2 * * *")).toBe("Every 2 hours");
      expect(describeCron("30 */4 * * *")).toBe("Every 4 hours");
    });

    it("should return invalid for bad expressions", () => {
      expect(describeCron("bad")).toBe("Invalid schedule");
      expect(describeCron("")).toBe("Invalid schedule");
    });

    it("should fall back to raw expression for complex patterns", () => {
      // Hour ranges should fall back to raw
      expect(describeCron("0 9-17 * * *")).toBe("0 9-17 * * *");
      // Day of week ranges should fall back to raw
      expect(describeCron("0 9 * * 1-5")).toBe("0 9 * * 1-5");
      // Complex combinations
      expect(describeCron("0 9-17 * * 1-5")).toBe("0 9-17 * * 1-5");
    });
  });

  describe("isValidCron", () => {
    it("should return true for valid expressions", () => {
      expect(isValidCron("* * * * *")).toBe(true);
      expect(isValidCron("0 9 * * *")).toBe(true);
      expect(isValidCron("*/5 * * * *")).toBe(true);
      expect(isValidCron("0 9-17 * * 1-5")).toBe(true);
    });

    it("should return false for invalid expressions", () => {
      expect(isValidCron("")).toBe(false);
      expect(isValidCron("bad")).toBe(false);
      expect(isValidCron("* *")).toBe(false);
      expect(isValidCron("* * * * * *")).toBe(false);
    });
  });
});
