import { AttendanceSummaryStatus } from '@prisma/client';
import { isWeeklyOff } from './date-utils.js';
import { getAggregateWorkedMinutes } from '../modules/attendance/attendance-summary.service.js';

/**
 * Calculates worked percentage from total worked minutes vs expected.
 * Formula: totalWorkedMinutes / (workingDays * fullDayMinutes)
 */
function calculateWorkedPercentage(totalWorkedMinutes, workingDays, fullDayMinutes) {
  const expectedMinutes = workingDays * fullDayMinutes;
  if (expectedMinutes === 0) return 0;
  return Math.round((totalWorkedMinutes / expectedMinutes) * 10000) / 100;
}

/**
 * Aggregates attendance statistics for multiple users across a date range.
 * Used by team/manager views.
 *
 * @param {string[]} userIds - Array of user IDs to aggregate
 * @param {string[]} dates - Array of date strings (YYYY-MM-DD)
 * @param {Map<string, Map<string, object>>} summariesByUserId - userId -> date -> summary
 * @param {Set<string>} holidayDateSet - Set of holiday dates (YYYY-MM-DD)
 * @param {Map<string, string>} userCreatedDateMap - Optional map of userId -> created date
 * @returns {object} Aggregated stats with day counts and attendance percentage
 */
export function aggregateAttendanceStats(
  userIds,
  dates,
  summariesByUserId,
  holidayDateSet,
  userCreatedDateMap = null,
) {
  let totalPresent = 0;
  let totalHalf = 0;
  let totalAbsent = 0;
  let totalLeave = 0;
  let totalHoliday = 0;
  let totalWeeklyOff = 0;
  let wm = 0;

  for (const uid of userIds) {
    const userCreatedDate = userCreatedDateMap?.get(uid) ?? null;
    const userSummaries = summariesByUserId.get(uid) || new Map();

    for (const date of dates) {
      // Skip dates before user was created
      if (userCreatedDate && date < userCreatedDate) continue;

      if (isWeeklyOff(date)) {
        totalWeeklyOff++;
        continue;
      }
      if (holidayDateSet.has(date)) {
        totalHoliday++;
        continue;
      }

      const summary = userSummaries.get(date);
      if (summary) {
        switch (summary.status) {
          case AttendanceSummaryStatus.PRESENT:
            totalPresent++;
            wm += getAggregateWorkedMinutes(date, summary);
            break;
          case AttendanceSummaryStatus.HALF_DAY:
          case AttendanceSummaryStatus.WORKING:
            totalHalf++;
            wm += getAggregateWorkedMinutes(date, summary);
            break;
          case AttendanceSummaryStatus.ABSENT:
            totalAbsent++;
            break;
          case AttendanceSummaryStatus.ON_LEAVE:
            totalLeave++;
            break;
        }
      } else {
        totalAbsent++;
      }
    }
  }

  const attendancePercentage
    = calculateWorkedPercentage(wm, totalPresent + totalHalf + totalAbsent, 9 * 60);

  return {
    presentDays: totalPresent + totalHalf,
    halfDays: totalHalf,
    absentDays: totalAbsent,
    leaveDays: totalLeave,
    holidayDays: totalHoliday,
    weeklyOffDays: totalWeeklyOff,
    totalWorkedMinutes: wm,
    attendancePercentage,
  };
}

/**
 * Computes attendance summary for a single user across a date range.
 * Includes worked minutes calculation.
 *
 * @param {string[]} dates - Array of date strings (YYYY-MM-DD)
 * @param {Map<string, object>} summaryMap - date -> summary for this user
 * @param {Set<string>} holidayDateSet - Set of holiday dates (YYYY-MM-DD)
 * @param {number} fullDayMinutes - Expected minutes for a full working day
 * @param {string} userCreatedDate - Optional user creation date (YYYY-MM-DD)
 * @param {boolean} includeWorkedMinutes - Whether to calculate totalWorkedMinutes
 * @param {object} options - Optional behavior flags
 * @param {string|null} options.countMissingAsAbsentThroughDate - Latest date where missing rows count as absent
 * @returns {object} User stats with day counts and attendance percentage
 */
export function computeUserAttendanceStats(
  dates,
  summaryMap,
  holidayDateSet,
  fullDayMinutes,
  userCreatedDate = null,
  includeWorkedMinutes = true,
  options = {},
) {
  const { countMissingAsAbsentThroughDate = null } = options;
  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let weeklyOffDays = 0;
  let totalWorkedMinutes = 0;

  for (const date of dates) {
    // Skip dates before user was created
    if (userCreatedDate && date < userCreatedDate) continue;

    if (isWeeklyOff(date)) {
      weeklyOffDays++;
      continue;
    }
    if (holidayDateSet.has(date)) {
      holidayDays++;
      continue;
    }

    const summary = summaryMap.get(date);
    if (summary) {
      switch (summary.status) {
        case AttendanceSummaryStatus.PRESENT:
          presentDays++;
          if (includeWorkedMinutes) {
            totalWorkedMinutes += getAggregateWorkedMinutes(date, summary);
          }
          break;
        case AttendanceSummaryStatus.HALF_DAY:
        case AttendanceSummaryStatus.WORKING:
          halfDays++;
          if (includeWorkedMinutes) {
            totalWorkedMinutes += getAggregateWorkedMinutes(date, summary);
          }
          break;
        case AttendanceSummaryStatus.ABSENT:
          absentDays++;
          break;
        case AttendanceSummaryStatus.ON_LEAVE:
          leaveDays++;
          break;
      }
    } else if (
      !countMissingAsAbsentThroughDate ||
      date <= countMissingAsAbsentThroughDate
    ) {
      absentDays++;
    }
  }

  const workingDays = presentDays + halfDays + absentDays;
  const attendancePercentage = calculateWorkedPercentage(
    totalWorkedMinutes,
    workingDays,
    fullDayMinutes,
  );

  const result = {
    presentDays,
    halfDays,
    absentDays,
    leaveDays,
    holidayDays,
    weeklyOffDays,
    attendancePercentage,
  };

  if (includeWorkedMinutes) {
    result.totalWorkedMinutes = totalWorkedMinutes;
  }

  return result;
}
