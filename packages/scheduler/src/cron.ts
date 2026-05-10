/**
 * Parse a cron expression and return the next run time after a given start time.
 * Supports standard 5-field cron format: minute hour dayOfMonth month dayOfWeek
 *
 * @param cronExpression - Standard 5-field cron expression
 * @param after - The date to start searching from (defaults to now)
 * @returns Next run time or null if invalid/no match found within a year
 */
export function parseNextRun(cronExpression: string, after?: Date): Date | null {
  try {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const startTime = after ?? new Date();
    let candidate = new Date(
      startTime.getFullYear(),
      startTime.getMonth(),
      startTime.getDate(),
      startTime.getHours(),
      startTime.getMinutes()
    );

    // Search up to 1 year (525600 minutes)
    for (let i = 0; i < 525600; i++) {
      candidate = new Date(candidate.getTime() + 60000);
      if (matchesCron(candidate, parts)) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a date matches a cron expression
 */
function matchesCron(dt: Date, parts: string[]): boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    matchesField(dt.getMinutes(), minute!) &&
    matchesField(dt.getHours(), hour!) &&
    matchesField(dt.getDate(), dayOfMonth!) &&
    matchesField(dt.getMonth() + 1, month!) &&
    matchesField(dt.getDay(), dayOfWeek!)
  );
}

/**
 * Check if a value matches a cron field
 * Supports: * (wildcard), step values (asterisk/n), ranges (n-m), lists (a,b,c), specific values
 */
function matchesField(value: number, field: string): boolean {
  if (field === "*") return true;

  // Step values: */n
  if (field.startsWith("*/")) {
    const step = parseInt(field.substring(2), 10);
    if (!isNaN(step) && step > 0) {
      return value % step === 0;
    }
  }

  // Ranges: n-m
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr!, 10);
    const end = parseInt(endStr!, 10);
    if (!isNaN(start) && !isNaN(end)) {
      return value >= start && value <= end;
    }
  }

  // Lists: a,b,c
  if (field.includes(",")) {
    const values = field
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    return values.includes(value);
  }

  // Specific value
  const fieldValue = parseInt(field, 10);
  return fieldValue === value;
}

/**
 * Generate a human-readable description of a cron expression
 *
 * @param cronExpression - Standard 5-field cron expression
 * @returns Human-readable description
 */
export function describeCron(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid schedule";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes (check first before other patterns)
  if (minute?.startsWith("*/")) {
    return `Every ${minute.substring(2)} minutes`;
  }

  // Every N hours (check before daily pattern)
  if (hour?.startsWith("*/")) {
    return `Every ${hour.substring(2)} hours`;
  }

  // Every hour at minute 0
  if (
    minute === "0" &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return "Every hour";
  }

  // Daily at specific time (only simple hour values, not ranges)
  if (
    minute !== "*" &&
    hour !== "*" &&
    !hour?.includes("-") &&
    !hour?.includes(",") &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Daily at ${formatTime(hour!, minute!)}`;
  }

  // Weekly on specific day at specific time (only simple values)
  if (
    minute !== "*" &&
    hour !== "*" &&
    !hour?.includes("-") &&
    !hour?.includes(",") &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek !== "*" &&
    !dayOfWeek?.includes("-") &&
    !dayOfWeek?.includes(",")
  ) {
    return `${formatDayOfWeek(dayOfWeek!)} at ${formatTime(hour!, minute!)}`;
  }

  // Fallback to raw expression
  return cronExpression;
}

/**
 * Format hour and minute as 12-hour time
 */
function formatTime(hourStr: string, minuteStr: string): string {
  const h = parseInt(hourStr, 10) || 0;
  const m = parseInt(minuteStr, 10) || 0;
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Format day of week number as human-readable string
 */
function formatDayOfWeek(dow: string): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const index = parseInt(dow, 10);
  if (!isNaN(index) && index >= 0 && index < 7) {
    return `Every ${days[index]}`;
  }
  if (dow === "*") return "Every day";
  return "Weekly";
}

/**
 * Validate a cron expression
 *
 * @param cronExpression - Cron expression to validate
 * @returns True if valid, false otherwise
 */
export function isValidCron(cronExpression: string): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // Try to parse next run - if it works, the expression is valid
  return parseNextRun(cronExpression) !== null;
}
