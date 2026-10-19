import { CronExpressionParser } from "cron-parser";

import type { ScheduleDefinitionV1, ScheduledJobV1 } from "@second-brain/contracts";

export interface OccurrencePreview {
  nextRunAt?: string;
  occurrences: string[];
}

export interface SchedulePreviewOptions {
  now: Date;
  count?: number;
  minFrequencyMs?: number;
}

export function previewSchedule(
  schedule: ScheduleDefinitionV1,
  options: SchedulePreviewOptions
): OccurrencePreview {
  assertValidScheduleTimezone(schedule);
  const count = options.count ?? 3;
  const occurrences =
    schedule.type === "once"
      ? previewOnce(schedule.runAt, options.now)
      : schedule.type === "interval"
        ? previewInterval(schedule.seconds, options.now, count)
        : previewCron(schedule.expression, schedule.timezone, options.now, count);

  enforceMinimumFrequency(occurrences, options.minFrequencyMs ?? 60_000);

  return {
    ...(occurrences[0] ? { nextRunAt: occurrences[0] } : {}),
    occurrences
  };
}

export function previewOnceSchedule(job: ScheduledJobV1, now: Date): OccurrencePreview {
  return previewSchedule(job.schedule, { now, count: 3 });
}

export function assertValidScheduleTimezone(schedule: ScheduleDefinitionV1): void {
  if (schedule.type === "once") {
    return;
  }
  assertValidTimezone(schedule.timezone);
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

export function nextOccurrence(schedule: ScheduleDefinitionV1, now: Date): string | undefined {
  return previewSchedule(schedule, { now, count: 1 }).nextRunAt;
}

function previewOnce(runAt: string, now: Date): string[] {
  const runAtDate = new Date(runAt);
  if (Number.isNaN(runAtDate.getTime())) {
    throw new Error(`Invalid once schedule timestamp: ${runAt}`);
  }
  return runAtDate.getTime() > now.getTime() ? [runAtDate.toISOString()] : [];
}

function previewInterval(seconds: number, now: Date, count: number): string[] {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error("Interval schedule seconds must be a positive integer.");
  }

  return Array.from({ length: count }, (_, index) =>
    new Date(now.getTime() + seconds * 1000 * (index + 1)).toISOString()
  );
}

function previewCron(expression: string, timezone: string, now: Date, count: number): string[] {
  const interval = CronExpressionParser.parse(expression, {
    currentDate: now,
    tz: timezone
  });

  return interval.take(count).map((date) => date.toDate().toISOString());
}

function enforceMinimumFrequency(occurrences: string[], minFrequencyMs: number): void {
  if (occurrences.length < 2) {
    return;
  }

  for (let index = 1; index < occurrences.length; index += 1) {
    const previous = new Date(occurrences[index - 1]!).getTime();
    const current = new Date(occurrences[index]!).getTime();
    if (current - previous < minFrequencyMs) {
      throw new Error(`Schedule frequency must be at least ${minFrequencyMs}ms.`);
    }
  }
}
