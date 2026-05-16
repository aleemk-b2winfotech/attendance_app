import { toDateString } from "../../common/index.js";
import {
  computeUserAttendanceStats,
} from "../../common/attendance-stats.js";
import { env } from "../../config/env.js";

// Re-export from holidays module for backwards compatibility
export { buildHolidayDateSet } from "../holidays/holidays.helpers.js";

// Re-export from common attendance-stats for backwards compatibility
export { aggregateAttendanceStats } from "../../common/attendance-stats.js";

/**
 * Builds summary map: userId -> date -> summary.
 */
export function buildSummariesByUserId(summaries) {
  const map = new Map();
  for (const s of summaries) {
    if (!map.has(s.userId)) {
      map.set(s.userId, new Map());
    }
    map.get(s.userId).set(toDateString(s.attendanceDate), s);
  }
  return map;
}

/**
 * Computes month summary for a single user.
 * This is a wrapper around computeUserAttendanceStats for backwards compatibility.
 * Returns format expected by existing dashboard code.
 */
export function computeUserMonthSummary(
  summaryDates,
  summaryMap,
  holidayDateSet,
  options = {},
) {
  const { FULL_DAY_MINUTES } = env();
  const stats = computeUserAttendanceStats(
    summaryDates,
    summaryMap,
    holidayDateSet,
    FULL_DAY_MINUTES,
    null,
    true,
    options,
  );

  // Transform to match expected format (combine presentDays and halfDays)
  return {
    presentDays: stats.presentDays + stats.halfDays,
    absentDays: stats.absentDays,
    leaveDays: stats.leaveDays,
    holidayDays: stats.holidayDays,
    weeklyOffDays: stats.weeklyOffDays,
    attendancePercentage: stats.attendancePercentage,
  };
}
