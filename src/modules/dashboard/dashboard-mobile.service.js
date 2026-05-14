import { LeaveStatus, AttendanceSummaryStatus, WorkMode } from "@prisma/client";
import { getPrisma } from "../../config/database.js";
import {
  businessToday,
  businessMonthStart,
  dateRange,
  isWeeklyOff,
  clampEndDate,
  toDateString,
  withEffectiveRoles,
} from "../../common/index.js";
import { getEffectiveSummaryWorkedMinutes } from "../attendance/attendance-summary.service.js";
import {
  buildHolidayDateSet,
  computeUserMonthSummary,
} from "./dashboard.helpers.js";
import { getHolidaysInRange } from "../holidays/holidays.helpers.js";
import { isWorkFromHomeDay } from "../work-from-home/work-from-home.service.js";

/**
 * Mobile dashboard aggregation for a single employee.
 *
 * Includes:
 * - profile card
 * - today's live status
 * - month-to-date closed summary
 * - recent 7 closed working days
 * - pending leave + upcoming holidays
 */
export async function getMobileDashboard(userId) {
  const prisma = getPrisma();
  const today = businessToday();
  const monthStart = businessMonthStart();

  // Basic profile card
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      createdAt: true,
      manager: { select: { id: true, fullName: true } },
    },
  });

  const userCreatedDate = user?.createdAt ? toDateString(user.createdAt) : null;

  // Today's live status
  const [todaySummary, todayIsWorkFromHome] = await Promise.all([
    prisma.attendanceSummary.findUnique({
      where: {
        userId_attendanceDate: { userId, attendanceDate: new Date(today) },
      },
    }),
    isWorkFromHomeDay(userId, today, prisma),
  ]);

  const todayWorkMode =
    todaySummary?.workMode ??
    (todaySummary
      ? null
      : todayIsWorkFromHome
        ? WorkMode.WFH
        : WorkMode.OFFICE);

  let todayStatus = {
    date: today,
    status: "notPunchedIn",
    workMode: todayWorkMode,
    todayPlan: todaySummary?.todayPlan ?? null,
    report: todaySummary?.report ?? null,
  };
  if (todaySummary) {
    if (todaySummary.status === AttendanceSummaryStatus.WORKING) {
      todayStatus = {
        date: today,
        status: "working",
        punchInAt: todaySummary.punchInAt?.toISOString(),
        workMode: todayWorkMode,
        todayPlan: todaySummary.todayPlan ?? null,
        report: todaySummary.report ?? null,
      };
    } else if (todaySummary.punchInAt && todaySummary.punchOutAt) {
      todayStatus = {
        date: today,
        status: "completed",
        punchInAt: todaySummary.punchInAt.toISOString(),
        punchOutAt: todaySummary.punchOutAt.toISOString(),
        workedMinutes: getEffectiveSummaryWorkedMinutes(today, todaySummary),
        workMode: todayWorkMode,
        todayPlan: todaySummary.todayPlan ?? null,
        report: todaySummary.report ?? null,
      };
    } else if (todaySummary.status === AttendanceSummaryStatus.ON_LEAVE) {
      todayStatus = {
        date: today,
        status: "onLeave",
        workMode: todayWorkMode,
        todayPlan: todaySummary.todayPlan ?? null,
        report: todaySummary.report ?? null,
      };
    }
  }

  // Calendar status supersedes raw punch state
  if (isWeeklyOff(today)) {
    todayStatus = {
      date: today,
      status: "weeklyOff",
      workMode: todayWorkMode,
      todayPlan: todaySummary?.todayPlan ?? null,
      report: todaySummary?.report ?? null,
    };
  }

  // Check if today is a holiday
  const todayHoliday = await prisma.holiday.findFirst({
    where: {
      isDeleted: false,
      startDate: { lte: new Date(today) },
      endDate: { gte: new Date(today) },
    },
  });
  if (todayHoliday) {
    todayStatus = {
      date: today,
      status: "holiday",
      holiday: todayHoliday.title,
      workMode: todayWorkMode,
      todayPlan: todaySummary?.todayPlan ?? null,
      report: todaySummary?.report ?? null,
    };
  }

  // Current-day approved leave blocks punch status; regularization is past-day only.
  const todayLeave =
    todaySummary?.status === AttendanceSummaryStatus.ON_LEAVE
      ? true
      : await prisma.leaveRequest.findFirst({
          where: {
            userId,
            status: LeaveStatus.APPROVED,
            OR: [
              {
                approvedStartDate: null,
                startDate: { lte: new Date(today) },
                endDate: { gte: new Date(today) },
              },
              {
                approvedStartDate: { lte: new Date(today) },
                approvedEndDate: { gte: new Date(today) },
              },
            ],
          },
        });
  if (todayLeave) {
    todayStatus = {
      date: today,
      status: "onLeave",
      workMode: todayWorkMode,
      todayPlan: todaySummary?.todayPlan ?? null,
      report: todaySummary?.report ?? null,
    };
  }

  // Month summary through yesterday
  const { appliedEndDate } = clampEndDate(today);
  const summaryStartDate =
    userCreatedDate && userCreatedDate > monthStart
      ? userCreatedDate
      : monthStart;
  const summaryDates = dateRange(summaryStartDate, appliedEndDate);

  const [summaries, holidays] = await Promise.all([
    prisma.attendanceSummary.findMany({
      where: {
        userId,
        attendanceDate: {
          gte: new Date(summaryStartDate),
          lte: new Date(appliedEndDate),
        },
      },
    }),
    getHolidaysInRange(monthStart, appliedEndDate),
  ]);

  const summaryMap = new Map(
    summaries.map((s) => [toDateString(s.attendanceDate), s]),
  );
  const holidayDateSet = buildHolidayDateSet(holidays);
  const monthSummary = computeUserMonthSummary(
    summaryDates,
    summaryMap,
    holidayDateSet,
  );

  // Pending leaves
  const pendingLeaves = await prisma.leaveRequest.findMany({
    where: { userId, status: { in: [LeaveStatus.PENDING] } },
    orderBy: { startDate: "asc" },
    take: 5,
  });

  // Upcoming holidays
  const upcomingHolidays = await prisma.holiday.findMany({
    where: { isDeleted: false, endDate: { gte: new Date(today) } },
    orderBy: { startDate: "asc" },
    take: 2,
    select: { id: true, title: true, startDate: true, endDate: true },
  });

  // Upcoming 5 WFH days
  const upcomingWFHDays = (
    await prisma.WorkFromHomeDay.findMany({
      where: { userId, attendanceDate: { gte: new Date(today) } },
      orderBy: { attendanceDate: "asc" },
      take: 5,
    })
  ).map((d) => toDateString(d.attendanceDate));
  
  return {
    user: withEffectiveRoles(user),
    todayStatus,
    monthSummary,
    pendingLeaves,
    upcomingHolidays,
    upcomingWFHDays
  };
}
