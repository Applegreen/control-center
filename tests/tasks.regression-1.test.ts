import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanTaskItems,
  completeTaskItems,
  nextRecurringDue,
} from "../lib/tasks";
import type { TaskItem } from "../lib/types";

// Regression: ISSUE-005 — recurring completions disappeared when the series rolled forward
// Found by /qa on 2026-08-25
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-25.md

const recurring: TaskItem = {
  id: "series-1",
  title: "Publish weekly briefing",
  description: "Ship the niche update.",
  due: "2026-08-25",
  recurrence: "Weekly",
  priority: "Normal",
  done: false,
  createdAt: "2026-08-20T18:00:00.000Z",
};

test("completing a recurring task advances the series and records its occurrence", () => {
  const now = new Date(2026, 7, 25, 12);
  const result = completeTaskItems([recurring], recurring.id, {
    now,
    occurrenceId: "occurrence-1",
  });
  const active = result.find((task) => task.id === recurring.id);
  const occurrence = result.find((task) => task.id === "occurrence-1");

  assert.equal(result.length, 2);
  assert.equal(active?.done, false);
  assert.equal(active?.due, "2026-09-01");
  assert.equal(occurrence?.done, true);
  assert.equal(occurrence?.due, "2026-08-25");
  assert.equal(occurrence?.seriesId, recurring.id);
  assert.equal(occurrence?.completedAt, now.toISOString());
});

test("repeated recurring completions retain every dated occurrence", () => {
  const first = completeTaskItems([recurring], recurring.id, {
    now: new Date(2026, 7, 25, 12),
    occurrenceId: "occurrence-1",
  });
  const second = completeTaskItems(first, recurring.id, {
    now: new Date(2026, 8, 1, 12),
    occurrenceId: "occurrence-2",
  });

  assert.equal(second.filter((task) => !task.done).length, 1);
  assert.equal(second.filter((task) => task.done).length, 2);
  assert.equal(
    second.find((task) => task.id === recurring.id)?.due,
    "2026-09-08",
  );
});

test("a stale double-click cannot complete and advance the same occurrence twice", () => {
  const now = new Date(2026, 7, 25, 12);
  const first = completeTaskItems([recurring], recurring.id, {
    now,
    occurrenceId: "occurrence-1",
    expectedDue: "2026-08-25",
  });
  const second = completeTaskItems(first, recurring.id, {
    now,
    occurrenceId: "occurrence-2",
    expectedDue: "2026-08-25",
  });

  assert.deepEqual(second, first);
  assert.equal(second.filter((task) => task.done).length, 1);
  assert.equal(second.find((task) => task.id === recurring.id)?.due, "2026-09-01");
});

test("one-time completions keep their original row and completion time", () => {
  const oneTime = { ...recurring, id: "one", recurrence: "One-time" };
  const now = new Date(2026, 7, 25, 15);
  const result = completeTaskItems([oneTime], oneTime.id, { now });

  assert.equal(result.length, 1);
  assert.equal(result[0].done, true);
  assert.equal(result[0].completedAt, now.toISOString());
  assert.equal(result[0].seriesId, undefined);
});

test("overdue recurrences advance to the first date after completion day", () => {
  assert.equal(
    nextRecurringDue("2026-08-20", "Daily", new Date(2026, 7, 25, 12)),
    "2026-08-26",
  );
});

test("monthly recurrences retain their anchor day after a short month", () => {
  const monthly = {
    ...recurring,
    id: "monthly-series",
    due: "2027-01-31",
    recurrence: "Monthly",
  };
  const february = completeTaskItems([monthly], monthly.id, {
    now: new Date(2027, 0, 31, 12),
    occurrenceId: "january-occurrence",
  });
  const march = completeTaskItems(february, monthly.id, {
    now: new Date(2027, 1, 28, 12),
    occurrenceId: "february-occurrence",
  });

  assert.equal(
    february.find((task) => task.id === monthly.id)?.due,
    "2027-02-28",
  );
  assert.equal(
    march.find((task) => task.id === monthly.id)?.due,
    "2027-03-31",
  );
});

test("workspace cleaning preserves completion history metadata", () => {
  const [cleaned] = cleanTaskItems([{
    ...recurring,
    id: "occurrence-1",
    done: true,
    completedAt: "2026-08-25T19:00:00.000Z",
    seriesId: recurring.id,
  }]);

  assert.equal(cleaned.completedAt, "2026-08-25T19:00:00.000Z");
  assert.equal(cleaned.seriesId, recurring.id);
});
