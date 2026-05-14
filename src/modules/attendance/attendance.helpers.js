import {
  AttendanceSummaryStatus,
  AttendanceSummarySource,
} from "@prisma/client";
import {
  isWeeklyOff,
  isToday,
  isPast,
  toDateString,
  isManagerScoped,
  appendNonAdminUserFilter,
} from "../../common/index.js";
import { getEffectiveSummaryWorkedMinutes } from "./attendance-summary.service.js";

// Re-export from holidays module for backwards compatibility
export {
  getHolidaysInRange,
  buildHolidayDateMap,
} from "../holidays/holidays.helpers.js";

/**
 * Builds Prisma where clause for attendance scope based on caller role.
 */
export function buildAttendanceScopeWhere(
  callerRoles,
  callerId,
  search,
  options = {},
) {
  const where = {
    isActive: true,
  };
  if (options.excludeAdmins) {
    appendNonAdminUserFilter(where);
  }
  if (isManagerScoped(callerRoles)) {
    where.managerUserId = callerId;
  }
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  return where;
}

/**
 * Converts array of records to date-keyed map.
 */
export function buildDateKeyedMap(records) {
  return new Map(
    records.map((record) => [
      toDateString(record.attendanceDate),
      record,
    ]),
  );
}

/**
 * Builds nested map: userId -> date -> record.
 */
export function buildDateKeyedMapsByUserId(records) {
  const map = new Map();
  for (const record of records) {
    const date = toDateString(record.attendanceDate);
    if (!map.has(record.userId)) {
      map.set(record.userId, new Map());
    }
    map.get(record.userId).set(date, record);
  }
  return map;
}

function summaryStatusToAttendanceState(status, isCurrentDay = false) {
  switch (status) {
    case AttendanceSummaryStatus.WORKING:
      return isCurrentDay ? "working" : "halfDay";
    case AttendanceSummaryStatus.PRESENT:
      return "present";
    case AttendanceSummaryStatus.HALF_DAY:
      return "halfDay";
    case AttendanceSummaryStatus.ABSENT:
      return "absent";
    case AttendanceSummaryStatus.ON_LEAVE:
      return "onLeave";
    default:
      return "absent";
  }
}

/**
 * Builds attendance day object from summary row.
 */
export function buildAttendanceDayFromSummary(date, summary, holiday, options = {}) {
  const flags = [];
  let dayType = "workingDay";
  let attendanceState;
  const workedMinutes = getEffectiveSummaryWorkedMinutes(date, summary);

  if (isWeeklyOff(date)) {
    dayType = "weeklyOff";
    attendanceState = "weeklyOff";
  } else if (holiday) {
    dayType = "holiday";
    attendanceState = "holiday";
  } else if (summary) {
    attendanceState = summaryStatusToAttendanceState(
      summary.status,
      isToday(date),
    );
    if (summary.source === AttendanceSummarySource.REGULARIZATION) {
      if (
        summary.status === AttendanceSummaryStatus.HALF_DAY ||
        summary.status === AttendanceSummaryStatus.ABSENT
      ) {
        flags.push("regularized");
      }
    }
    if (
      summary.source === AttendanceSummarySource.PUNCH &&
      summary.punchInAt &&
      !summary.punchOutAt &&
      !isToday(date)
    ) {
      flags.push("missingPunchOut");
    }
  } else if (isPast(date)) {
    attendanceState = "absent";
  } else {
    attendanceState = "absent";
  }

  const day = {
    date,
    dayType,
    attendanceState,
    punchInAt: summary?.punchInAt?.toISOString() ?? null,
    punchOutAt: summary?.punchOutAt?.toISOString() ?? null,
    workedMinutes,
    workMode: summary?.workMode ?? options.workMode ?? null,
    todayPlan: summary?.todayPlan ?? options.todayPlan ?? null,
    report: summary?.report ?? options.report ?? null,
    flags,
    holiday: holiday ? { id: holiday.id, title: holiday.title } : null,
    leaveRequest: summary?.leaveRequestId
      ? {
        id: summary.leaveRequestId,
        status: summary.leaveRequest?.status ?? "APPROVED",
      }
      : null,
    regularization: summary?.regularizationId
      ? {
        id: summary.regularizationId,
        overrideStatus: summary.regularization?.overrideStatus ?? null,
        reason: summary.regularization?.reason ?? null,
      }
      : null,
  };
  if (options.includeLocation) {
    day.location = options.location ?? null;
  }
  return day;
}

/**
 * Checks if day matches attendance status filter.
 */
export function matchesAttendanceStatus(day, status) {
  if (!status) {
    return true;
  }
  if (status === "regularized") {
    return Boolean(day.regularization);
  }
  return day.attendanceState === status;
}

/**
 * Computes summary statistics from array of day objects.
 */
export function computeSummary(days) {
  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let weeklyOffDays = 0;
  let wc = 0;

  for (const d of days) {
    switch (d.attendanceState) {
      case "present":
      case "regularized":
        if (d.regularization?.overrideStatus === "HALF_DAY") halfDays++;
        else if (d.regularization?.overrideStatus === "ABSENT") absentDays++;
        else presentDays++;
        break;
      case "halfDay":
        halfDays++;
        break;
      case "absent":
        absentDays++;
        break;
      case "onLeave":
        leaveDays++;
        break;
      case "holiday":
        holidayDays++;
        break;
      case "weeklyOff":
        weeklyOffDays++;
        break;
    }
    wc += d.workedMinutes;
  }

  const denominator = (presentDays + halfDays + absentDays) * 9 * 60;
  const attendancePercentage =
    denominator > 0 ? Math.round((wc / denominator) * 10000) / 100 : 0;

  return {
    presentDays,
    halfDays,
    absentDays,
    leaveDays,
    holidayDays,
    weeklyOffDays,
    attendancePercentage,
  };
}
