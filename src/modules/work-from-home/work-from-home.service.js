import { ConflictError, BadRequestError, NotFoundError } from "../../common/errors.js";
import {
  assertDirectReportAccess,
  buildManagerScopeWhere,
  businessToday,
  dateRange,
  intersectDateRanges,
  isWeeklyOff,
  toDateString,
} from "../../common/index.js";
import { getPrisma } from "../../config/database.js";
import { LeaveStatus, Prisma } from "@prisma/client";
import { getHolidayDatesInRange } from "../holidays/holidays.helpers.js";
import { paginate, paginationMeta } from "../../common/pagination.js";

const ASSIGN_WORK_FROM_HOME_MAX_RETRIES = 3;

function expandRanges(ranges) {
  const dates = new Set();

  for (const range of ranges) {
    for (const date of dateRange(range.startDate, range.endDate)) {
      dates.add(date);
    }
  }

  return [...dates].sort((left, right) => left.localeCompare(right));
}

function ensureFutureDatesOnly(dates, today) {
  const invalidDate = dates.find((date) => date <= today);
  if (invalidDate) {
    throw new BadRequestError(
      `WFH dates must be after today. Invalid date: ${invalidDate}`,
    );
  }
}

function buildLeaveConflictDates(selectedDates, approvedLeaves) {
  if (selectedDates.length === 0) {
    return [];
  }

  const selectedDateSet = new Set(selectedDates);
  const conflicts = new Set();
  const selectedStartDate = selectedDates[0];
  const selectedEndDate = selectedDates[selectedDates.length - 1];

  for (const leave of approvedLeaves) {
    const leaveStartDate = toDateString(leave.approvedStartDate ?? leave.startDate);
    const leaveEndDate = toDateString(leave.approvedEndDate ?? leave.endDate);
    const overlappingRange = intersectDateRanges(
      leaveStartDate,
      leaveEndDate,
      selectedStartDate,
      selectedEndDate,
    );

    if (!overlappingRange) {
      continue;
    }

    for (const date of dateRange(
      overlappingRange.startDate,
      overlappingRange.endDate,
    )) {
      if (selectedDateSet.has(date)) {
        conflicts.add(date);
      }
    }
  }

  return [...conflicts].sort((left, right) => left.localeCompare(right));
}

function buildDateListMessage(prefix, dates) {
  return `${prefix}: ${dates.join(", ")}`;
}

function formatWorkFromHomeDay(day) {
  return {
    id: day.id,
    attendanceDate: toDateString(day.attendanceDate),
    createdAt: day.createdAt,
    updatedAt: day.updatedAt,
    user: day.user
      ? {
          id: day.user.id,
          fullName: day.user.fullName,
          email: day.user.email,
        }
      : undefined,
    createdBy: day.createdBy
      ? {
          id: day.createdBy.id,
          fullName: day.createdBy.fullName,
        }
      : undefined,
  };
}

function formatTargetUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
  };
}

async function getScopedTargetUser(callerRoles, callerId, userId, action) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      managerUserId: true,
      role: true,
    },
  });

  if (!user) {
    throw new NotFoundError("User");
  }

  assertDirectReportAccess(callerRoles, callerId, user, action);
  return user;
}

async function validateWorkFromHomeCreateDates(userId, dates, db) {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const weeklyOffDates = dates.filter((date) => isWeeklyOff(date));

  if (weeklyOffDates.length > 0) {
    throw new BadRequestError(
      buildDateListMessage("Cannot assign WFH on weekly off dates", weeklyOffDates),
    );
  }

  const [holidayDates, approvedLeaves] = await Promise.all([
    getHolidayDatesInRange(startDate, endDate, db),
    db.leaveRequest.findMany({
      where: {
        userId,
        status: LeaveStatus.APPROVED,
        OR: [
          {
            approvedStartDate: null,
            startDate: { lte: new Date(endDate) },
            endDate: { gte: new Date(startDate) },
          },
          {
            approvedStartDate: { lte: new Date(endDate) },
            approvedEndDate: { gte: new Date(startDate) },
          },
        ],
      },
      select: {
        startDate: true,
        endDate: true,
        approvedStartDate: true,
        approvedEndDate: true,
      },
    }),
  ]);

  const holidayConflicts = dates.filter((date) => holidayDates.has(date));
  if (holidayConflicts.length > 0) {
    throw new ConflictError(
      buildDateListMessage("WFH dates overlap with holidays", holidayConflicts),
    );
  }

  const leaveConflicts = buildLeaveConflictDates(dates, approvedLeaves);
  if (leaveConflicts.length > 0) {
    throw new ConflictError(
      buildDateListMessage("WFH dates overlap with approved leave", leaveConflicts),
    );
  }
}

function isRetryableTransactionConflict(error) {
  return error?.code === "P2034";
}

async function createWorkFromHomeDays(
  prisma,
  userId,
  callerId,
  dates,
) {
  let attempt = 0;

  while (attempt < ASSIGN_WORK_FROM_HOME_MAX_RETRIES) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await validateWorkFromHomeCreateDates(userId, dates, tx);

          const result = await tx.workFromHomeDay.createMany({
            data: dates.map((date) => ({
              userId,
              attendanceDate: new Date(date),
              createdByUserId: callerId,
            })),
            skipDuplicates: true,
          });

          return result.count;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      attempt += 1;

      if (
        isRetryableTransactionConflict(error) &&
        attempt < ASSIGN_WORK_FROM_HOME_MAX_RETRIES
      ) {
        continue;
      }

      if (isRetryableTransactionConflict(error)) {
        throw new ConflictError(
          "Could not assign work from home because the calendar changed during the request. Please retry.",
        );
      }

      throw error;
    }
  }

  return 0;
}

export async function assignWorkFromHomeDays(
  callerRoles,
  callerId,
  userId,
  payload,
) {
  const prisma = getPrisma();
  const user = await getScopedTargetUser(
    callerRoles,
    callerId,
    userId,
    "assign work from home for",
  );
  const dates = expandRanges(payload.ranges);
  const today = businessToday();

  ensureFutureDatesOnly(dates, today);
  const count = await createWorkFromHomeDays(prisma, userId, callerId, dates);

  return {
    user: formatTargetUser(user),
    dates,
    count,
  };
}

export async function deleteWorkFromHomeDays(
  callerRoles,
  callerId,
  userId,
  payload,
) {
  const user = await getScopedTargetUser(
    callerRoles,
    callerId,
    userId,
    "remove work from home for",
  );
  const dates = expandRanges(payload.ranges);
  const today = businessToday();

  ensureFutureDatesOnly(dates, today);

  const prisma = getPrisma();
  const deleteResult = await prisma.workFromHomeDay.deleteMany({
    where: {
      userId,
      attendanceDate: { in: dates.map((date) => new Date(date)) },
    },
  });

  return {
    user: formatTargetUser(user),
    dates,
    deletedCount: deleteResult.count,
  };
}

export async function listWorkFromHomeDays(callerRoles, callerId, filters) {
  const prisma = getPrisma();
  const userWhere = {
    isActive: true,
    ...buildManagerScopeWhere(callerRoles, callerId),
  };

  if (filters.search) {
    userWhere.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const where = { user: userWhere };
  if (filters.startDate || filters.endDate) {
    where.attendanceDate = {};
    if (filters.startDate) {
      where.attendanceDate.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.attendanceDate.lte = new Date(filters.endDate);
    }
  }

  const [total, items] = await Promise.all([
    prisma.workFromHomeDay.count({ where }),
    prisma.workFromHomeDay.findMany({
      where,
      orderBy: [{ attendanceDate: "asc" }, { createdAt: "desc" }],
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
        createdBy: {
          select: { id: true, fullName: true },
        },
      },
      ...paginate(filters.page, filters.limit),
    }),
  ]);

  return {
    items: items.map(formatWorkFromHomeDay),
    meta: paginationMeta(total, filters.page, filters.limit),
  };
}

export async function isWorkFromHomeDay(
  userId,
  date,
  db = getPrisma(),
) {
  const row = await db.workFromHomeDay.findUnique({
    where: {
      userId_attendanceDate: {
        userId,
        attendanceDate: new Date(date),
      },
    },
    select: { id: true },
  });

  return Boolean(row);
}

export async function getWorkFromHomeDatesByUserIds(
  userIds,
  startDate,
  endDate,
  db = getPrisma(),
) {
  if (!userIds.length || startDate > endDate) {
    return [];
  }

  return db.workFromHomeDay.findMany({
    where: {
      userId: { in: userIds },
      attendanceDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
  });
}
