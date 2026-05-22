import { getPrisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import {
  businessToday,
  businessMonthStart,
  dateRange,
  clampEndDate,
  toDateString,
  computeUserAttendanceStats,
} from "../../common/index.js";
import {
  getHolidaysInRange,
  buildHolidayDateMap,
  buildAttendanceScopeWhere,
  buildDateKeyedMap,
  buildDateKeyedMapsByUserId,
  buildAttendanceDayFromSummary,
  matchesAttendanceStatus,
  computeSummary,
} from "./attendance.helpers.js";

/**
 * Builds day-wise attendance timeline + summary for one user.
 */
export async function getUserAttendanceOverview(
  userId,
  startDate,
  endDate,
  includeHolidayHistory = false,
) {
  const prisma = getPrisma();
  const today = businessToday();

  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  const userCreatedDate = userRecord?.createdAt
    ? toDateString(userRecord.createdAt)
    : null;

  const requestedStart = startDate || businessMonthStart();
  const effectiveStart =
    userCreatedDate && userCreatedDate > requestedStart
      ? userCreatedDate
      : requestedStart;

  const requestedEnd = endDate || today;
  const { appliedEndDate, currentDateExcluded } = clampEndDate(requestedEnd);
  const displayEndDate = requestedEnd >= today ? today : requestedEnd;
  const aggregateEndDate = appliedEndDate;

  const dates = dateRange(effectiveStart, displayEndDate);
  const [summaries, holidays] = await Promise.all([
    prisma.attendanceSummary.findMany({
      where: {
        userId,
        attendanceDate: {
          gte: new Date(effectiveStart),
          lte: new Date(displayEndDate),
        },
      },
      include: {
        leaveRequest: { select: { id: true, status: true } },
        regularization: {
          select: { id: true, overrideStatus: true, reason: true },
        },
      },
    }),
    getHolidaysInRange(effectiveStart, displayEndDate),
  ]);

  const summaryMap = buildDateKeyedMap(summaries);
  const holidayMap = buildHolidayDateMap(holidays);

  const days = dates.map((date) =>
    buildAttendanceDayFromSummary(
      date,
      summaryMap.get(date),
      holidayMap.get(date),
    ),
  );

  const summaryDays = days.filter((d) => d.date <= aggregateEndDate);
  const summary = computeSummary(summaryDays);

  const result = {
    range: {
      startDate: effectiveStart,
      endDate: displayEndDate,
      appliedEndDate: aggregateEndDate,
      currentDateExcluded,
    },
    summary,
    days,
  };

  if (includeHolidayHistory) {
    const holidayChangeLogs = await prisma.holidayChangeLog.findMany({
      where: {
        holiday: {
          startDate: { lte: new Date(displayEndDate) },
          endDate: { gte: new Date(effectiveStart) },
        },
      },
      include: {
        changedBy: { select: { id: true, fullName: true } },
        holiday: { select: { id: true, title: true } },
      },
      orderBy: { changedAt: "desc" },
    });
    result.holidayHistory = holidayChangeLogs;
  }

  return result;
}

/**
 * Multi-user attendance overview for web portal tables.
 */
export async function getWebAttendanceOverview(callerRoles, callerId, filters) {
  const prisma = getPrisma();
  const today = businessToday();

  const effectiveStart = filters.startDate || businessMonthStart();
  const rawEnd = filters.endDate || today;
  const { appliedEndDate, currentDateExcluded } = clampEndDate(rawEnd);

  const where = buildAttendanceScopeWhere(
    callerRoles,
    callerId,
    filters.search,
    { excludeAdmins: true },
  );

  const [total, users, aggregateUsers] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        createdAt: true,
      },
      orderBy: { fullName: "asc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const aggregateUserIds = aggregateUsers.map((user) => user.id);

  const [summaries, holidays] = await Promise.all([
    prisma.attendanceSummary.findMany({
      where: {
        userId: { in: aggregateUserIds },
        attendanceDate: {
          gte: new Date(effectiveStart),
          lte: new Date(appliedEndDate),
        },
      },
    }),
    getHolidaysInRange(effectiveStart, appliedEndDate),
  ]);

  const { FULL_DAY_MINUTES } = env();
  const holidayMap = buildHolidayDateMap(holidays);
  const dates = dateRange(effectiveStart, appliedEndDate);
  const summariesByUserId = buildDateKeyedMapsByUserId(summaries);

  const items = users.map((user) => {
    const userSummaries = summariesByUserId.get(user.id) || new Map();
    const userCreatedDate = user.createdAt
      ? toDateString(user.createdAt)
      : null;

    // Use shared attendance stats calculation
    const stats = computeUserAttendanceStats(
      dates,
      userSummaries,
      holidayMap,
      FULL_DAY_MINUTES,
      userCreatedDate,
      true,
    );

    return {
      user: { id: user.id, fullName: user.fullName, email: user.email },
      summary: {
        presentDays: stats.presentDays,
        halfDays: stats.halfDays,
        absentDays: stats.absentDays,
        leaveDays: stats.leaveDays,
        holidayDays: stats.holidayDays,
        weeklyOffDays: stats.weeklyOffDays,
        totalWorkedMinutes: stats.totalWorkedMinutes,
        attendancePercentage: stats.attendancePercentage,
      },
    };
  });

  const aggregateTotals = {
    presentDays: 0,
    halfDays: 0,
    absentDays: 0,
    totalWorkedMinutes: 0,
  };
  for (const user of aggregateUsers) {
    const userSummaries = summariesByUserId.get(user.id) || new Map();
    const userCreatedDate = user.createdAt
      ? toDateString(user.createdAt)
      : null;
    const stats = computeUserAttendanceStats(
      dates,
      userSummaries,
      holidayMap,
      FULL_DAY_MINUTES,
      userCreatedDate,
      true,
    );

    aggregateTotals.presentDays += stats.presentDays;
    aggregateTotals.halfDays += stats.halfDays;
    aggregateTotals.absentDays += stats.absentDays;
    aggregateTotals.totalWorkedMinutes += stats.totalWorkedMinutes;
  }

  const workingDays =
    aggregateTotals.presentDays +
    aggregateTotals.halfDays +
    aggregateTotals.absentDays;
  const aggregate = {
    presentDays: aggregateTotals.presentDays,
    halfDays: aggregateTotals.halfDays,
    absentDays: aggregateTotals.absentDays,
    attendancePercentage: workingDays > 0
      ? Math.round(
        (aggregateTotals.totalWorkedMinutes /
          (workingDays * FULL_DAY_MINUTES)) *
            10000,
      ) / 100
      : 0,
  };

  return {
    range: {
      startDate: effectiveStart,
      endDate: rawEnd,
      appliedEndDate,
      currentDateExcluded,
    },
    aggregate,
    items,
    meta: {
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    },
  };
}

/**
 * Paginated row-level attendance records for web attendance table.
 */
export async function getWebAttendanceRecords(callerRoles, callerId, filters) {
  const prisma = getPrisma();
  const today = businessToday();

  const effectiveStart = filters.startDate || businessMonthStart();
  const requestedEndDate = filters.endDate || today;
  const effectiveEnd = requestedEndDate > today ? today : requestedEndDate;

  const where = buildAttendanceScopeWhere(
    callerRoles,
    callerId,
    filters.search,
  );

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      email: true,
      createdAt: true,
    },
    orderBy: { fullName: "asc" },
  });

  const userIds = users.map((user) => user.id);

  if (userIds.length === 0 || effectiveStart > effectiveEnd) {
    return {
      range: {
        startDate: effectiveStart,
        endDate: effectiveEnd,
        requestedEndDate,
        futureDatesTrimmed: requestedEndDate > today,
      },
      items: [],
      meta: {
        total: 0,
        page: filters.page,
        limit: filters.limit,
        totalPages: 0,
      },
    };
  }

  const [summaries, holidays] = await Promise.all([
    prisma.attendanceSummary.findMany({
      where: {
        userId: { in: userIds },
        attendanceDate: {
          gte: new Date(effectiveStart),
          lte: new Date(effectiveEnd),
        },
      },
      include: {
        leaveRequest: { select: { id: true, status: true } },
        regularization: {
          select: { id: true, overrideStatus: true, reason: true },
        },
      },
    }),
    getHolidaysInRange(effectiveStart, effectiveEnd),
  ]);

  const holidayMap = buildHolidayDateMap(holidays);
  const summariesByUserId = buildDateKeyedMapsByUserId(summaries);
  const dates = dateRange(effectiveStart, effectiveEnd);

  const rows = [];
  for (const user of users) {
    const userSummaries = summariesByUserId.get(user.id) || new Map();
    const userCreatedDate = user.createdAt
      ? toDateString(user.createdAt)
      : null;

    for (const date of dates) {
      if (userCreatedDate && date < userCreatedDate) continue;
      const summary = userSummaries.get(date);
      const day = buildAttendanceDayFromSummary(
        date,
        summary,
        holidayMap.get(date),
      );

      if (date === today && !summary) continue;
      if (!matchesAttendanceStatus(day, filters.status)) continue;

      rows.push({
        user: { id: user.id, fullName: user.fullName, email: user.email },
        ...day,
      });
    }
  }

  rows.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.user.fullName.localeCompare(right.user.fullName) ||
      left.user.email.localeCompare(right.user.email),
  );

  const total = rows.length;
  const startIndex = (filters.page - 1) * filters.limit;
  const items = rows.slice(startIndex, startIndex + filters.limit);

  return {
    range: {
      startDate: effectiveStart,
      endDate: effectiveEnd,
      requestedEndDate,
      futureDatesTrimmed: requestedEndDate > today,
    },
    items,
    meta: {
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    },
  };
}
