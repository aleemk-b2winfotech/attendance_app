import { randomUUID } from "node:crypto";
import {
  AttendanceSummaryStatus,
  AttendanceSummarySource,
  LeaveStatus,
  OverrideStatus,
} from "@prisma/client";
import { getPrisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import {
  isToday,
  isWeeklyOff,
  dateRange,
  intersectDateRanges,
  toDateString,
} from "../../common/index.js";
import { getHolidayDatesInRange } from "../holidays/holidays.helpers.js";

// Keep parity with the current server behavior: LEAVE > REGULARIZATION > PUNCH.
const SOURCE_PRIORITY = {
  [AttendanceSummarySource.LEAVE]: 3,
  [AttendanceSummarySource.REGULARIZATION]: 2,
  [AttendanceSummarySource.PUNCH]: 1,
};

function getSourcePriority(source) {
  return SOURCE_PRIORITY[source] || 0;
}

function buildSummaryKey(userId, date) {
  return `${userId}:${date}`;
}

function summaryWhere(userId, date) {
  return {
    userId_attendanceDate: {
      userId,
      attendanceDate: new Date(date),
    },
  };
}

function getApprovedLeaveStartDate(leaveRequest) {
  return toDateString(leaveRequest.approvedStartDate ?? leaveRequest.startDate);
}

function getApprovedLeaveEndDate(leaveRequest) {
  return toDateString(leaveRequest.approvedEndDate ?? leaveRequest.endDate);
}

function mapOverrideStatusToSummaryStatus(overrideStatus) {
  switch (overrideStatus) {
    case OverrideStatus.PRESENT:
      return AttendanceSummaryStatus.PRESENT;
    case OverrideStatus.HALF_DAY:
      return AttendanceSummaryStatus.HALF_DAY;
    case OverrideStatus.ABSENT:
      return AttendanceSummaryStatus.ABSENT;
    default:
      return AttendanceSummaryStatus.PRESENT;
  }
}

function getPunchSummaryFields(date, punch) {
  const { FULL_DAY_MINUTES, HALF_DAY_MINUTES } = env();
  let workedMinutes = punch.workedMinutes ?? null;
  let status = AttendanceSummaryStatus.HALF_DAY;

  if (punch.punchInAt && punch.punchOutAt) {
    status =
      workedMinutes != null && workedMinutes >= FULL_DAY_MINUTES
        ? AttendanceSummaryStatus.PRESENT
        : AttendanceSummaryStatus.HALF_DAY;
  } else if (punch.punchInAt && !punch.punchOutAt) {
    if (isToday(date)) {
      status = AttendanceSummaryStatus.WORKING;
    } else {
      status = AttendanceSummaryStatus.HALF_DAY;
      workedMinutes ??= HALF_DAY_MINUTES;
    }
  } else if (!punch.punchInAt && punch.punchOutAt) {
    status = AttendanceSummaryStatus.HALF_DAY;
    workedMinutes ??= HALF_DAY_MINUTES;
  } else {
    workedMinutes ??= HALF_DAY_MINUTES;
  }

  return {
    status,
    punchInAt: punch.punchInAt,
    punchOutAt: punch.punchOutAt,
    workedMinutes,
  };
}

function mergeDisplayedAttendanceFields(punch, regularization) {
  return {
    punchInAt: regularization?.overridePunchInAt ?? punch?.punchInAt ?? null,
    punchOutAt: regularization?.overridePunchOutAt ?? punch?.punchOutAt ?? null,
  };
}

function getPunchMetadataFields(punch) {
  return {
    workMode: punch?.workMode ?? null,
    todayPlan: punch?.todayPlan ?? null,
    report: punch?.report ?? null,
  };
}

function buildSummaryRowData(date, punch, regularization, leave) {
  if (leave) {
    const displayed = mergeDisplayedAttendanceFields(punch, regularization);
    return {
      status: AttendanceSummaryStatus.ON_LEAVE,
      source: AttendanceSummarySource.LEAVE,
      ...getPunchMetadataFields(punch),
      punchInAt: displayed.punchInAt,
      punchOutAt: displayed.punchOutAt,
      workedMinutes:
        regularization?.overrideWorkedMinutes ?? punch?.workedMinutes ?? null,
      leaveRequestId: leave.id,
      regularizationId: regularization?.id ?? null,
    };
  }

  if (regularization) {
    const displayed = mergeDisplayedAttendanceFields(punch, regularization);
    return {
      status: mapOverrideStatusToSummaryStatus(regularization.overrideStatus),
      source: AttendanceSummarySource.REGULARIZATION,
      ...getPunchMetadataFields(punch),
      punchInAt: displayed.punchInAt,
      punchOutAt: displayed.punchOutAt,
      workedMinutes: regularization.overrideWorkedMinutes ?? null,
      leaveRequestId: null,
      regularizationId: regularization.id,
    };
  }

  if (punch && (punch.punchInAt || punch.punchOutAt)) {
    const punchFields = getPunchSummaryFields(date, punch);
    return {
      ...punchFields,
      ...getPunchMetadataFields(punch),
      source: AttendanceSummarySource.PUNCH,
      leaveRequestId: null,
      regularizationId: null,
    };
  }

  return null;
}

function getClosedPunchFallbackWorkedMinutes(summary) {
  const { HALF_DAY_MINUTES } = env();

  if (
    summary?.source === AttendanceSummarySource.PUNCH && summary.punchInAt && !summary.punchOutAt
  ) {
    return HALF_DAY_MINUTES;
  }

  return null;
}

export function getEffectiveSummaryWorkedMinutes(date, summary) {
  if (!summary) {
    return null;
  }

  if (summary.status === AttendanceSummaryStatus.WORKING && !isToday(date)) {
    return (
      summary.workedMinutes ?? getClosedPunchFallbackWorkedMinutes(summary)
    );
  }

  if (
    summary.status === AttendanceSummaryStatus.HALF_DAY &&
    summary.source === AttendanceSummarySource.PUNCH
  ) {
    return (
      summary.workedMinutes ?? getClosedPunchFallbackWorkedMinutes(summary)
    );
  }

  return summary.workedMinutes ?? null;
}

export function getAggregateWorkedMinutes(date, summary) {
  if (!summary) {
    return 0;
  }

  switch (summary.status) {
    case AttendanceSummaryStatus.PRESENT:
    case AttendanceSummaryStatus.HALF_DAY:
    case AttendanceSummaryStatus.WORKING:
      return getEffectiveSummaryWorkedMinutes(date, summary) ?? 0;
    default:
      return 0;
  }
}

async function getEffectiveApprovedLeaveDates(leaveRequest, db = getPrisma()) {
  const startDate = getApprovedLeaveStartDate(leaveRequest);
  const endDate = getApprovedLeaveEndDate(leaveRequest);
  const leaveDates = dateRange(
    startDate,
    endDate,
  );
  const holidayDates = await getHolidayDatesInRange(
    startDate,
    endDate,
    db,
  );

  return leaveDates.filter(
    (date) => !isWeeklyOff(date) && !holidayDates.has(date),
  );
}

async function createSummariesInBatches(rows, db) {
  if (rows.length === 0) {
    return;
  }

  const batchSize = 500;
  for (let index = 0; index < rows.length; index += batchSize) {
    await db.attendanceSummary.createMany({
      data: rows.slice(index, index + batchSize),
    });
  }
}

function buildSummaryRows({
  punches,
  regularizations,
  approvedLeaves,
  holidayDates,
  rangeStart = null,
  rangeEnd = null,
}) {
  const summaryInputs = new Map();
  const isInRequestedRange = (date) => {
    if (rangeStart && date < rangeStart) {
      return false;
    }
    if (rangeEnd && date > rangeEnd) {
      return false;
    }
    return true;
  };

  for (const punch of punches) {
    if (!punch.punchInAt && !punch.punchOutAt) {
      continue;
    }
    const date = toDateString(punch.attendanceDate);
    if (!isInRequestedRange(date)) {
      continue;
    }
    const key = buildSummaryKey(punch.userId, date);
    const existing = summaryInputs.get(key) ?? {};
    summaryInputs.set(key, { ...existing, userId: punch.userId, date, punch });
  }

  for (const regularization of regularizations) {
    const date = toDateString(regularization.attendanceDate);
    if (!isInRequestedRange(date)) {
      continue;
    }
    const key = buildSummaryKey(regularization.userId, date);
    const existing = summaryInputs.get(key) ?? {};
    summaryInputs.set(key, {
      ...existing,
      userId: regularization.userId,
      date,
      regularization,
    });
  }

  for (const leave of approvedLeaves) {
    const leaveStartDate = getApprovedLeaveStartDate(leave);
    const leaveEndDate = getApprovedLeaveEndDate(leave);
    const overlappingRange =
      rangeStart && rangeEnd
        ? intersectDateRanges(leaveStartDate, leaveEndDate, rangeStart, rangeEnd)
        : {
          startDate: leaveStartDate,
          endDate: leaveEndDate,
        };

    if (!overlappingRange) {
      continue;
    }

    const leaveDates = dateRange(
      overlappingRange.startDate,
      overlappingRange.endDate,
    );

    for (const date of leaveDates) {
      if (isWeeklyOff(date) || holidayDates.has(date)) {
        continue;
      }
      const key = buildSummaryKey(leave.userId, date);
      const existing = summaryInputs.get(key) ?? {};
      summaryInputs.set(key, {
        ...existing,
        userId: leave.userId,
        date,
        leave,
      });
    }
  }

  const rows = [];
  for (const input of summaryInputs.values()) {
    if (!isInRequestedRange(input.date)) {
      continue;
    }
    if (isWeeklyOff(input.date) || holidayDates.has(input.date)) {
      continue;
    }

    const row = buildSummaryRowData(
      input.date,
      input.punch,
      input.regularization,
      input.leave,
    );

    if (!row) {
      continue;
    }

    rows.push({
      id: randomUUID(),
      userId: input.userId,
      attendanceDate: new Date(input.date),
      ...row,
    });
  }

  return rows;
}

async function withOptionalTransaction(db, work) {
  if (typeof db?.$transaction === "function") {
    return db.$transaction(async (tx) => work(tx));
  }

  return work(db);
}

async function buildRangeSummaryRows(
  startDate,
  endDate,
  db,
  scopedUserIds = null,
) {
  const start = toDateString(startDate);
  const end = toDateString(endDate);
  const scopedUserSet = scopedUserIds ? new Set(scopedUserIds) : null;
  const whereUserId = scopedUserIds?.length ? { in: scopedUserIds } : undefined;

  const [
    punches,
    regularizations,
    approvedLeaves,
    existingSummaries,
    holidayDates,
  ] = await Promise.all([
    db.attendancePunch.findMany({
      where: {
        ...(whereUserId && { userId: whereUserId }),
        attendanceDate: {
          gte: new Date(start),
          lte: new Date(end),
        },
      },
    }),
    db.attendanceRegularization.findMany({
      where: {
        ...(whereUserId && { userId: whereUserId }),
        attendanceDate: {
          gte: new Date(start),
          lte: new Date(end),
        },
      },
    }),
    db.leaveRequest.findMany({
      where: {
        ...(whereUserId && { userId: whereUserId }),
        status: LeaveStatus.APPROVED,
        OR: [
          {
            startDate: { lte: new Date(end) },
            endDate: { gte: new Date(start) },
          },
          {
            approvedStartDate: { lte: new Date(end) },
            approvedEndDate: { gte: new Date(start) },
          },
        ],
      },
    }),
    db.attendanceSummary.findMany({
      where: {
        ...(whereUserId && { userId: whereUserId }),
        attendanceDate: {
          gte: new Date(start),
          lte: new Date(end),
        },
      },
      select: { userId: true },
    }),
    getHolidayDatesInRange(start, end, db),
  ]);

  const userIds = [
    ...new Set([
      ...punches.map((record) => record.userId),
      ...regularizations.map((record) => record.userId),
      ...approvedLeaves.map((record) => record.userId),
      ...existingSummaries.map((record) => record.userId),
    ]),
  ].filter((userId) => !scopedUserSet || scopedUserSet.has(userId));

  if (userIds.length === 0) {
    return { start, end, userIds, rows: [] };
  }

  const rows = buildSummaryRows({
    punches,
    regularizations,
    approvedLeaves,
    holidayDates,
    rangeStart: start,
    rangeEnd: end,
  }).filter((row) => userIds.includes(row.userId));

  return { start, end, userIds, rows };
}

export async function upsertSummaryFromPunch(
  userId,
  date,
  punch,
  db = getPrisma(),
) {
  const existing = await db.attendanceSummary.findUnique({
    where: summaryWhere(userId, date),
  });

  if (
    existing &&
    getSourcePriority(existing.source) >
    getSourcePriority(AttendanceSummarySource.PUNCH)
  ) {
    await rebuildSummaryForDate(userId, date, db);

    return db.attendanceSummary.findUnique({
      where: summaryWhere(userId, date),
    });
  }

  const summaryData = buildSummaryRowData(date, punch, null, null);
  if (!summaryData) {
    return null;
  }

  return db.attendanceSummary.upsert({
    where: summaryWhere(userId, date),
    create: {
      userId,
      attendanceDate: new Date(date),
      ...summaryData,
    },
    update: summaryData,
  });
}

export async function upsertSummaryFromApprovedLeave(
  leaveRequest,
  db = getPrisma(),
) {
  const effectiveDates = await getEffectiveApprovedLeaveDates(leaveRequest, db);
  const dateFilters = effectiveDates.map((date) => new Date(date));
  const [punches, regularizations] = await Promise.all([
    effectiveDates.length === 0
      ? []
      : db.attendancePunch.findMany({
        where: {
          userId: leaveRequest.userId,
          attendanceDate: { in: dateFilters },
        },
      }),
    effectiveDates.length === 0
      ? []
      : db.attendanceRegularization.findMany({
        where: {
          userId: leaveRequest.userId,
          attendanceDate: { in: dateFilters },
        },
      }),
  ]);
  const punchMap = new Map(
    punches.map((record) => [toDateString(record.attendanceDate), record]),
  );
  const regularizationMap = new Map(
    regularizations.map((record) => [toDateString(record.attendanceDate), record]),
  );
  const created = [];

  for (const date of effectiveDates) {
    const summaryData = buildSummaryRowData(
      date,
      punchMap.get(date) ?? null,
      regularizationMap.get(date) ?? null,
      leaveRequest,
    );
    const summary = await db.attendanceSummary.upsert({
      where: summaryWhere(leaveRequest.userId, date),
      create: {
        userId: leaveRequest.userId,
        attendanceDate: new Date(date),
        ...summaryData,
      },
      update: summaryData,
    });
    created.push(summary);
  }

  return created;
}

export async function upsertSummaryFromRegularization(
  userId,
  date,
  regularization,
  db = getPrisma(),
) {
  const [existing, punch] = await Promise.all([
    db.attendanceSummary.findUnique({
      where: summaryWhere(userId, date),
    }),
    db.attendancePunch.findUnique({
      where: summaryWhere(userId, date),
    }),
  ]);

  if (existing?.source === AttendanceSummarySource.LEAVE) {
    const displayed = mergeDisplayedAttendanceFields(punch, regularization);
    return db.attendanceSummary.update({
      where: { id: existing.id },
      data: {
        ...getPunchMetadataFields(punch),
        punchInAt: displayed.punchInAt,
        punchOutAt: displayed.punchOutAt,
        workedMinutes:
          regularization.overrideWorkedMinutes ?? punch?.workedMinutes ?? null,
        regularizationId: regularization.id,
      },
    });
  }

  const summaryData = buildSummaryRowData(date, punch, regularization, null);
  if (!summaryData) {
    return null;
  }

  return db.attendanceSummary.upsert({
    where: summaryWhere(userId, date),
    create: {
      userId,
      attendanceDate: new Date(date),
      ...summaryData,
    },
    update: summaryData,
  });
}

export async function rebuildSummariesForDateRange(
  startDate,
  endDate,
  db = getPrisma(),
  scopedUserIds = null,
) {
  return withOptionalTransaction(db, async (tx) => {
    const { start, end, userIds, rows } = await buildRangeSummaryRows(
      startDate,
      endDate,
      tx,
      scopedUserIds,
    );

    if (userIds.length === 0) {
      return { deletedCount: 0, createdCount: 0 };
    }

    const deleteResult = await tx.attendanceSummary.deleteMany({
      where: {
        userId: { in: userIds },
        attendanceDate: {
          gte: new Date(start),
          lte: new Date(end),
        },
      },
    });

    await createSummariesInBatches(rows, tx);

    return {
      deletedCount: deleteResult.count,
      createdCount: rows.length,
    };
  });
}

export async function rebuildSummaryForDate(userId, date, db = getPrisma()) {
  const result = await rebuildSummariesForDateRange(date, date, db, [userId]);
  return result.deletedCount > 0 || result.createdCount > 0 ? result : null;
}

async function buildAllSummaryRows(db) {
  const [punches, regularizations, approvedLeaves, holidayDates] =
    await Promise.all([
      db.attendancePunch.findMany(),
      db.attendanceRegularization.findMany(),
      db.leaveRequest.findMany({
        where: { status: LeaveStatus.APPROVED },
      }),
      getHolidayDatesInRange("1970-01-01", "2999-12-31", db),
    ]);

  return buildSummaryRows({
    punches,
    regularizations,
    approvedLeaves,
    holidayDates,
  });
}

export async function rebuildAllAttendanceSummaries(db = getPrisma()) {
  return withOptionalTransaction(db, async (tx) => {
    const rows = await buildAllSummaryRows(tx);
    const deleteResult = await tx.attendanceSummary.deleteMany({});

    await createSummariesInBatches(rows, tx);

    return {
      deletedCount: deleteResult.count,
      createdCount: rows.length,
    };
  });
}
