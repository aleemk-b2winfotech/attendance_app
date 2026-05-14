import { getPrisma } from "../../config/database.js";
import {
  BadRequestError,
  NotFoundError,
  assertDirectReportAccess,
} from "../../common/index.js";
import { isWeeklyOff, isPast } from "../../common/index.js";
import {
  upsertSummaryFromRegularization,
  rebuildSummaryForDate,
} from "./attendance-summary.service.js";
import { getHolidaysInRange, buildHolidayDateMap } from "./attendance.helpers.js";
import { OverrideStatus } from "@prisma/client";

/**
 * Creates or updates attendance regularization for a past working day.
 * Used by manager/admin to correct inaccurate punch-derived status.
 */
export async function upsertRegularization(
  callerRoles,
  callerId,
  targetUserId,
  date,
  data,
) {
  const prisma = getPrisma();

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
  });
  if (!targetUser) throw new NotFoundError("User");

  // Manager scope check
  assertDirectReportAccess(callerRoles, callerId, targetUser, 'regularize');

  // Cannot regularize on weekly off
  if (isWeeklyOff(date)) {
    throw new BadRequestError("Cannot regularize on a weekly off");
  }

  // Cannot regularize on holiday
  const holidays = await getHolidaysInRange(date, date);
  if (buildHolidayDateMap(holidays).has(date)) {
    throw new BadRequestError("Cannot regularize on a holiday");
  }

  // Regularization is only for closed days
  if (!isPast(date)) {
    throw new BadRequestError("Can only regularize past dates");
  }

  let overrideWorkedMinutes = null;
  if (data.overridePunchInAt && data.overridePunchOutAt) {
    overrideWorkedMinutes = Math.floor(
      (new Date(data.overridePunchOutAt).getTime() -
        new Date(data.overridePunchInAt).getTime()) /
      60000,
    );
  }

  if ([OverrideStatus.ABSENT, OverrideStatus.ON_LEAVE].includes(data.overrideStatus)) {
    data.overridePunchInAt = null;
    data.overridePunchOutAt = null;
    overrideWorkedMinutes = null;
  } else {
    if (data.overridePunchInAt && data.overridePunchOutAt && new Date(data.overridePunchOutAt) <= new Date(data.overridePunchInAt)) {
      throw new BadRequestError("Punch out time must be after punch in time");
    }

    if ((data.overridePunchInAt && !data.overridePunchOutAt) || (!data.overridePunchInAt && data.overridePunchOutAt)) {
      throw new BadRequestError("Both punch in and out times must be provided together");
    }

    if (!data.overridePunchInAt && !data.overridePunchOutAt) {
      throw new BadRequestError("Punch in and out times must be provided for present or half-day status");
    }

    if (data.overridePunchInAt && new Date(data.overridePunchInAt).toDateString() !== new Date(date).toDateString()) {
      throw new BadRequestError("Punch in time must be on the same day as attendance date");
    }

    if (data.overridePunchOutAt && new Date(data.overridePunchOutAt).toDateString() !== new Date(date).toDateString()) {
      throw new BadRequestError("Punch out time must be on the same day as attendance date");
    }
  }


  return prisma.$transaction(async (tx) => {
    const regularization = await tx.attendanceRegularization.upsert({
      where: {
        userId_attendanceDate: {
          userId: targetUserId,
          attendanceDate: new Date(date),
        },
      },
      create: {
        userId: targetUserId,
        attendanceDate: new Date(date),
        overrideStatus: data.overrideStatus,
        overridePunchInAt: data.overridePunchInAt
          ? new Date(data.overridePunchInAt)
          : null,
        overridePunchOutAt: data.overridePunchOutAt
          ? new Date(data.overridePunchOutAt)
          : null,
        overrideWorkedMinutes: overrideWorkedMinutes,
        reason: data.reason,
        actionByUserId: callerId,
      },
      update: {
        overrideStatus: data.overrideStatus,
        overridePunchInAt: data.overridePunchInAt
          ? new Date(data.overridePunchInAt)
          : null,
        overridePunchOutAt: data.overridePunchOutAt
          ? new Date(data.overridePunchOutAt)
          : null,
        overrideWorkedMinutes: overrideWorkedMinutes,
        reason: data.reason,
        actionByUserId: callerId,
      },
      include: { actionBy: { select: { id: true, fullName: true } } },
    });

    await upsertSummaryFromRegularization(
      targetUserId,
      date,
      regularization,
      tx,
    );

    return regularization;
  });
}

/**
 * Deletes an existing regularization record.
 * Scope restrictions match regularization create/update.
 */
export async function deleteRegularization(
  callerRoles,
  callerId,
  targetUserId,
  date,
) {
  const prisma = getPrisma();

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
  });
  if (!targetUser) throw new NotFoundError("User");

  assertDirectReportAccess(callerRoles, callerId, targetUser, 'manage');

  const existing = await prisma.attendanceRegularization.findUnique({
    where: {
      userId_attendanceDate: {
        userId: targetUserId,
        attendanceDate: new Date(date),
      },
    },
  });
  if (!existing) throw new NotFoundError("Regularization");

  await prisma.$transaction(async (tx) => {
    await tx.attendanceRegularization.delete({ where: { id: existing.id } });
    await rebuildSummaryForDate(targetUserId, date, tx);
  });

  return { deleted: true };
}
