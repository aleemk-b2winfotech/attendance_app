import { LeaveStatus, DeviceChangeStatus } from "@prisma/client";
import { getPrisma } from "../../config/database.js";
import {
  businessToday,
  businessMonthStart,
  dateRange,
  clampEndDate,
  toDateString,
  isManagerScoped,
  appendNonAdminUserFilter,
} from "../../common/index.js";
import {
  buildHolidayDateSet,
  buildSummariesByUserId,
  aggregateAttendanceStats,
} from "./dashboard.helpers.js";

/**
 * Web dashboard aggregation for manager/admin.
 *
 * Provides:
 * - scoped headcount
 * - pending approvals counts
 * - upcoming holidays
 * - aggregate attendance counters for selected range
 */
export async function getWebDashboard(
  callerRoles,
  callerId,
  startDate,
  endDate,
) {
  const prisma = getPrisma();
  const today = businessToday();

  const effectiveStart = startDate || businessMonthStart();
  const rawEnd = endDate || today;
  const { appliedEndDate, currentDateExcluded } = clampEndDate(rawEnd);

  // Keep all dashboard counters aligned to the same visible user scope.
  const userWhere = {
    // We include inactive users in headcount for consistency with user list
    // but we can filter by isActive if needed in the future.
  };
  appendNonAdminUserFilter(userWhere);
  if (isManagerScoped(callerRoles)) {
    userWhere.managerUserId = callerId;
  }

  const headcount = await prisma.user.count({ where: userWhere });

  // Pending leave count
  const pendingLeaveCount = await prisma.leaveRequest.count({
    where: {
      status: LeaveStatus.PENDING,
      user: userWhere,
    },
  });

  // Pending device change count
  const pendingDeviceChangeCount = await prisma.deviceChangeRequest.count({
    where: {
      status: DeviceChangeStatus.PENDING,
      user: userWhere,
    },
  });

  // Upcoming holidays
  const upcomingHolidays = await prisma.holiday.findMany({
    where: { isDeleted: false, endDate: { gte: new Date(today) } },
    orderBy: { startDate: "asc" },
    take: 5,
    select: { id: true, title: true, startDate: true, endDate: true },
  });

  // Aggregate attendance summary
  const users = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, createdAt: true },
  });

  const userIds = users.map((u) => u.id);
  const userCreatedDateMap = new Map(
    users.map((u) => [
      u.id,
      u.createdAt ? toDateString(u.createdAt) : null,
    ]),
  );

  const dates = dateRange(effectiveStart, appliedEndDate);

  const [summaries, holidays] = await Promise.all([
    prisma.attendanceSummary.findMany({
      where: {
        userId: { in: userIds },
        attendanceDate: {
          gte: new Date(effectiveStart),
          lte: new Date(appliedEndDate),
        },
      },
    }),
    prisma.holiday.findMany({
      where: {
        isDeleted: false,
        startDate: { lte: new Date(appliedEndDate) },
        endDate: { gte: new Date(effectiveStart) },
      },
    }),
  ]);

  const holidayDateSet = buildHolidayDateSet(holidays);
  const summariesByUserId = buildSummariesByUserId(summaries);

  const attendanceSummary = aggregateAttendanceStats(
    userIds,
    dates,
    summariesByUserId,
    holidayDateSet,
    userCreatedDateMap,
  );

  return {
    range: {
      startDate: effectiveStart,
      endDate: rawEnd,
      appliedEndDate,
      currentDateExcluded,
    },
    headcount,
    attendanceSummary,
    pendingLeaveCount,
    pendingDeviceChangeCount,
    upcomingHolidays,
  };
}
