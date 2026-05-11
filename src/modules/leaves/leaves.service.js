import { LeaveStatus, LeaveThreadMessageType } from "@prisma/client";
import { getPrisma } from "../../config/database.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors.js";
import {
  businessToday,
  countWorkingDays,
  dateRange,
  intersectDateRanges,
  isWeeklyOff,
  toDateString,
  buildManagerScopeUserWhere,
  assertDirectReportAccess,
} from "../../common/index.js";
import { paginate, paginationMeta } from "../../common/pagination.js";
import {
  upsertSummaryFromApprovedLeave,
} from "../attendance/attendance-summary.service.js";
import { getHolidayDatesInRange } from "../holidays/holidays.helpers.js";

function getEffectiveLeaveStartDate(leave) {
  return toDateString(leave.approvedStartDate ?? leave.startDate);
}

function getEffectiveLeaveEndDate(leave) {
  return toDateString(leave.approvedEndDate ?? leave.endDate);
}

function effectiveApprovedLeaveOverlapWhere(startDate, endDate) {
  return {
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
  };
}

async function getWorkingLeaveDates(startDate, endDate, db = getPrisma()) {
  const holidayDates = await getHolidayDatesInRange(startDate, endDate, db);
  const { count, workingDates } = countWorkingDays(
    startDate,
    endDate,
    holidayDates,
  );
  if (count === 0) {
    throw new BadRequestError("No working days in the selected range");
  }
  return { count, workingDates, holidayDates };
}

async function assertLeaveDateSelectionAvailable(
  userId,
  startDate,
  endDate,
  options = {},
) {
  const db = options.db ?? getPrisma();
  const today = businessToday();

  if (startDate > endDate) {
    throw new BadRequestError("startDate must be <= endDate");
  }
  if (startDate < today) {
    throw new BadRequestError("Leave cannot start in the past");
  }
  if (startDate === today) {
    const attendance = await db.attendancePunch.findUnique({
      where: {
        userId_attendanceDate: { userId, attendanceDate: new Date(today) },
      },
    });
    if (attendance?.punchInAt) {
      throw new BadRequestError("Cannot start leave today after punching in");
    }
  }

  const { count, workingDates, holidayDates } = await getWorkingLeaveDates(
    startDate,
    endDate,
    db,
  );

  const overlapping = await db.leaveRequest.findMany({
    where: {
      userId,
      status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
      ...(options.excludeLeaveRequestId && {
        id: { not: options.excludeLeaveRequestId },
      }),
      OR: [
        {
          status: LeaveStatus.PENDING,
          startDate: { lte: new Date(endDate) },
          endDate: { gte: new Date(startDate) },
        },
        {
          status: LeaveStatus.APPROVED,
          ...effectiveApprovedLeaveOverlapWhere(startDate, endDate),
        },
      ],
    },
  });

  for (const existing of overlapping) {
    const existingStartDate =
      existing.status === LeaveStatus.APPROVED
        ? getEffectiveLeaveStartDate(existing)
        : toDateString(existing.startDate);
    const existingEndDate =
      existing.status === LeaveStatus.APPROVED
        ? getEffectiveLeaveEndDate(existing)
        : toDateString(existing.endDate);
    const overlappingRange = intersectDateRanges(
      existingStartDate,
      existingEndDate,
      startDate,
      endDate,
    );
    if (!overlappingRange) {
      continue;
    }

    const existingWorkingDates = dateRange(
      overlappingRange.startDate,
      overlappingRange.endDate,
    ).filter((d) => !isWeeklyOff(d) && !holidayDates.has(d));

    const overlap = workingDates.filter((d) => existingWorkingDates.includes(d));
    if (overlap.length > 0) {
      throw new ConflictError(
        "Leave request overlaps with an existing pending/approved leave",
      );
    }
  }

  return { count, workingDates };
}

function ensurePendingLeave(leave) {
  if (leave.status !== LeaveStatus.PENDING) {
    throw new BadRequestError("Thread actions are only allowed for pending leave requests");
  }
}

function threadMessageInclude() {
  return {
    actor: { select: { id: true, fullName: true, email: true, roles: true } },
    acceptedThreadMessage: {
      select: {
        id: true,
        actorUserId: true,
        proposedStartDate: true,
        proposedEndDate: true,
        proposedWorkingDayCount: true,
      },
    },
  };
}

async function createThreadMessage(db, data) {
  return db.leaveThreadMessage.create({
    data,
    include: threadMessageInclude(),
  });
}

async function addInitialRequestThreadMessage(db, leave) {
  await createThreadMessage(db, {
    leaveRequestId: leave.id,
    actorUserId: leave.userId,
    messageType: LeaveThreadMessageType.REQUEST,
    message: leave.reason,
    proposedStartDate: leave.startDate,
    proposedEndDate: leave.endDate,
    proposedWorkingDayCount: leave.workingDayCount,
  });
}

async function getScopedWebLeaveRequest(callerRoles, callerId, leaveRequestId) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: { user: true },
  });
  if (!leave) throw new NotFoundError("Leave request");
  assertDirectReportAccess(callerRoles, callerId, leave.user, "access");
  return leave;
}

async function approveLeaveWithDates(
  db,
  leave,
  startDate,
  endDate,
  workingDayCount,
  actionByUserId,
  actionNote,
) {
  const approved = await db.leaveRequest.update({
    where: { id: leave.id },
    data: {
      status: LeaveStatus.APPROVED,
      approvedStartDate: new Date(startDate),
      approvedEndDate: new Date(endDate),
      approvedWorkingDayCount: workingDayCount,
      actionByUserId,
      actionAt: new Date(),
      actionNote: actionNote || null,
    },
    include: {
      user: { select: { id: true, fullName: true } },
      actionBy: { select: { id: true, fullName: true } },
    },
  });

  await upsertSummaryFromApprovedLeave(approved, db);
  return approved;
}

/**
 * Creates a leave request for future dates.
 *
 * Important behavior:
 * - only future-or-today starts are allowed
 * - working-day count excludes weekly offs + holidays
 * - overlap detection is performed on working dates only
 */
export async function createLeaveRequest(userId, data) {
  const prisma = getPrisma();
  const { count, workingDates } = await assertLeaveDateSelectionAvailable(
    userId,
    data.startDate,
    data.endDate,
  );

  // Persist computed workingDayCount so approvers can see impact immediately.
  const leave = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        userId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        workingDayCount: count,
        reason: data.reason,
        status: LeaveStatus.PENDING,
      },
    });
    await addInitialRequestThreadMessage(tx, created);
    return created;
  });
  return { ...leave, workingDates };
}
/**
 * Employee self-view list endpoint with status filter + pagination.
 */
export async function getMyLeaveRequests(userId, filters) {
  const prisma = getPrisma();
  const where = { userId };
  if (filters.status) {
    where.status = filters.status;
  }
  const [total, items] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { actionBy: { select: { id: true, fullName: true } } },
      ...paginate(filters.page, filters.limit),
    }),
  ]);
  return { items, meta: paginationMeta(total, filters.page, filters.limit) };
}
/**
 * Returns leave request details.
 * If `userId` is provided, ownership is enforced (employee self endpoints).
 */
export async function getLeaveRequestById(userId, leaveRequestId) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      actionBy: { select: { id: true, fullName: true } },
    },
  });
  if (!leave) throw new NotFoundError("Leave request");
  if (userId && leave.userId !== userId)
    throw new ForbiddenError("Not your leave request");
  return leave;
}

export async function getLeaveRequestByIdWeb(
  callerRoles,
  callerId,
  leaveRequestId,
) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: {
      user: { select: { id: true, fullName: true, email: true, managerUserId: true } },
      actionBy: { select: { id: true, fullName: true } },
    },
  });
  if (!leave) throw new NotFoundError("Leave request");
  assertDirectReportAccess(callerRoles, callerId, leave.user, "view");
  return leave;
}
/**
 * Employee cancellation endpoint.
 * Only pending requests are cancellable.
 */
export async function cancelLeaveRequest(userId, leaveRequestId) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
  });
  if (!leave) throw new NotFoundError("Leave request");
  if (leave.userId !== userId)
    throw new ForbiddenError("Not your leave request");
  if (leave.status !== LeaveStatus.PENDING) {
    throw new BadRequestError("Only pending leave requests can be cancelled");
  }
  return prisma.$transaction(async (tx) => {
    const cancelled = await tx.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: LeaveStatus.CANCELLED,
        actionByUserId: userId,
        actionAt: new Date(),
      },
    });

    await createThreadMessage(tx, {
      leaveRequestId,
      actorUserId: userId,
      messageType: LeaveThreadMessageType.CANCELLATION,
      message: "Cancelled",
    });

    return cancelled;
  });
}
/**
 * Web list endpoint for manager/admin workflows.
 * Managers are restricted to direct-report leaves.
 */
export async function listLeaveRequestsWeb(callerRoles, callerId, filters) {
  const prisma = getPrisma();
  const where = {};
  // Managers can act only on direct reports; admins get organization-wide view.
  Object.assign(where, buildManagerScopeUserWhere(callerRoles, callerId));
  if (filters.status) where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    const dateFilter = {};
    if (filters.startDate && filters.endDate) {
      dateFilter.AND = [
        { startDate: { lte: new Date(filters.endDate) } },
        { endDate: { gte: new Date(filters.startDate) } },
      ];
    } else if (filters.startDate) {
      dateFilter.endDate = { gte: new Date(filters.startDate) };
    } else if (filters.endDate) {
      dateFilter.startDate = { lte: new Date(filters.endDate) };
    }
    where.AND = [...(where.AND || []), ...(Array.isArray(dateFilter.AND) ? [{ AND: dateFilter.AND }] : [dateFilter])];
  }
  
  if (filters.search) {
    where.user = {
      ...where.user,
      OR: [
        { fullName: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ],
    };
  }
  const [total, items] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        actionBy: { select: { id: true, fullName: true } },
      },
      ...paginate(filters.page, filters.limit),
    }),
  ]);
  return { items, meta: paginationMeta(total, filters.page, filters.limit) };
}
/**
 * Approves one pending leave request.
 * Self-approval is blocked; manager scope is enforced.
 * Keeps current behavior where approved leave takes precedence in attendance views.
 */
export async function approveLeaveRequest(
  callerRoles,
  callerId,
  leaveRequestId,
  actionNote,
) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: { user: true },
  });
  if (!leave) throw new NotFoundError("Leave request");
  if (leave.status !== LeaveStatus.PENDING) {
    throw new BadRequestError("Only pending leave requests can be approved");
  }
  // Avoid self-approval, even if user has manager/admin role.
  if (leave.userId === callerId) {
    throw new ForbiddenError("Cannot approve your own leave request");
  }
  // Manager scope
  assertDirectReportAccess(callerRoles, callerId, leave.user, 'approve direct reports\' leave');
  return prisma.$transaction(async (tx) => {
    await createThreadMessage(tx, {
      leaveRequestId,
      actorUserId: callerId,
      messageType: LeaveThreadMessageType.DIRECT_APPROVAL,
      message: actionNote || "Direct approval",
      proposedStartDate: leave.startDate,
      proposedEndDate: leave.endDate,
      proposedWorkingDayCount: leave.workingDayCount,
    });

    return approveLeaveWithDates(
      tx,
      leave,
      toDateString(leave.startDate),
      toDateString(leave.endDate),
      leave.workingDayCount,
      callerId,
      actionNote,
    );
  });
}
/**
 * Rejects one pending leave request.
 * Requires actionNote to support explicit approval audit trail.
 */
export async function rejectLeaveRequest(
  callerRoles,
  callerId,
  leaveRequestId,
  actionNote,
) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: { user: true },
  });
  if (!leave) throw new NotFoundError("Leave request");
  if (leave.status !== LeaveStatus.PENDING) {
    throw new BadRequestError("Only pending leave requests can be rejected");
  }
  if (leave.userId === callerId) {
    throw new ForbiddenError("Cannot reject your own leave request");
  }
  assertDirectReportAccess(callerRoles, callerId, leave.user, 'reject direct reports\' leave');
  return prisma.$transaction(async (tx) => {
    const rejected = await tx.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: LeaveStatus.REJECTED,
        actionByUserId: callerId,
        actionAt: new Date(),
        actionNote,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        actionBy: { select: { id: true, fullName: true } },
      },
    });

    await createThreadMessage(tx, {
      leaveRequestId,
      actorUserId: callerId,
      messageType: LeaveThreadMessageType.REJECTION,
      message: actionNote,
    });

    return rejected;
  });
}

async function getEmployeeLeaveRequest(userId, leaveRequestId) {
  const prisma = getPrisma();
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: { user: true },
  });
  if (!leave) throw new NotFoundError("Leave request");
  if (leave.userId !== userId) {
    throw new ForbiddenError("Not your leave request");
  }
  return leave;
}

async function listThreadMessages(leaveRequestId) {
  const prisma = getPrisma();
  return prisma.leaveThreadMessage.findMany({
    where: { leaveRequestId },
    orderBy: { createdAt: "asc" },
    include: threadMessageInclude(),
  });
}

export async function getMyLeaveRequestThread(userId, leaveRequestId) {
  await getEmployeeLeaveRequest(userId, leaveRequestId);
  return {
    leaveRequestId,
    messages: await listThreadMessages(leaveRequestId),
  };
}

export async function getLeaveRequestThreadWeb(
  callerRoles,
  callerId,
  leaveRequestId,
) {
  await getScopedWebLeaveRequest(callerRoles, callerId, leaveRequestId);
  return {
    leaveRequestId,
    messages: await listThreadMessages(leaveRequestId),
  };
}

async function createLeaveThreadMessage(leave, actorUserId, data) {
  const prisma = getPrisma();
  const isProposal = Boolean(data.proposedStartDate || data.proposedEndDate);

  return prisma.$transaction(async (tx) => {
    const currentLeave = await tx.leaveRequest.findUnique({
      where: { id: leave.id },
    });
    if (!currentLeave) throw new NotFoundError("Leave request");
    ensurePendingLeave(currentLeave);

    if (!isProposal) {
      return createThreadMessage(tx, {
        leaveRequestId: leave.id,
        actorUserId,
        messageType: LeaveThreadMessageType.COMMENT,
        message: data.message,
      });
    }

    const { count } = await assertLeaveDateSelectionAvailable(
      currentLeave.userId,
      data.proposedStartDate,
      data.proposedEndDate,
      { excludeLeaveRequestId: currentLeave.id, db: tx },
    );

    return createThreadMessage(tx, {
      leaveRequestId: currentLeave.id,
      actorUserId,
      messageType: LeaveThreadMessageType.PROPOSAL,
      message: data.message || null,
      proposedStartDate: new Date(data.proposedStartDate),
      proposedEndDate: new Date(data.proposedEndDate),
      proposedWorkingDayCount: count,
    });
  });
}

export async function createMyLeaveThreadMessage(
  userId,
  leaveRequestId,
  data,
) {
  const leave = await getEmployeeLeaveRequest(userId, leaveRequestId);
  return createLeaveThreadMessage(leave, userId, data);
}

export async function createLeaveThreadMessageWeb(
  callerRoles,
  callerId,
  leaveRequestId,
  data,
) {
  const leave = await getScopedWebLeaveRequest(
    callerRoles,
    callerId,
    leaveRequestId,
  );
  return createLeaveThreadMessage(leave, callerId, data);
}

async function getProposalMessage(leaveRequestId, messageId) {
  const prisma = getPrisma();
  const proposal = await prisma.leaveThreadMessage.findUnique({
    where: { id: messageId },
    include: threadMessageInclude(),
  });
  if (!proposal || proposal.leaveRequestId !== leaveRequestId) {
    throw new NotFoundError("Leave thread message");
  }
  if (proposal.messageType !== LeaveThreadMessageType.PROPOSAL) {
    throw new BadRequestError("Only proposal messages can be accepted");
  }
  if (!proposal.proposedStartDate || !proposal.proposedEndDate) {
    throw new BadRequestError("Proposal is missing proposed dates");
  }
  return proposal;
}

async function acceptLeaveProposal({
  leave,
  proposal,
  acceptedByUserId,
  actionByUserId,
}) {
  if (proposal.actorUserId === acceptedByUserId) {
    throw new ForbiddenError("Cannot accept your own proposal");
  }

  const prisma = getPrisma();
  const proposedStartDate = toDateString(proposal.proposedStartDate);
  const proposedEndDate = toDateString(proposal.proposedEndDate);

  return prisma.$transaction(async (tx) => {
    const currentLeave = await tx.leaveRequest.findUnique({
      where: { id: leave.id },
      include: { user: true },
    });
    if (!currentLeave) throw new NotFoundError("Leave request");
    ensurePendingLeave(currentLeave);

    const currentProposal = await tx.leaveThreadMessage.findUnique({
      where: { id: proposal.id },
    });
    if (
      !currentProposal ||
      currentProposal.leaveRequestId !== leave.id ||
      currentProposal.messageType !== LeaveThreadMessageType.PROPOSAL
    ) {
      throw new NotFoundError("Leave thread message");
    }
    if (currentProposal.actorUserId === acceptedByUserId) {
      throw new ForbiddenError("Cannot accept your own proposal");
    }

    const { count } = await assertLeaveDateSelectionAvailable(
      currentLeave.userId,
      proposedStartDate,
      proposedEndDate,
      { excludeLeaveRequestId: currentLeave.id, db: tx },
    );

    const acceptance = await createThreadMessage(tx, {
      leaveRequestId: currentLeave.id,
      actorUserId: acceptedByUserId,
      messageType: LeaveThreadMessageType.ACCEPTANCE,
      message: "Accepted proposed leave dates",
      proposedStartDate: new Date(proposedStartDate),
      proposedEndDate: new Date(proposedEndDate),
      proposedWorkingDayCount: count,
      acceptedThreadMessageId: currentProposal.id,
    });

    const approved = await approveLeaveWithDates(
      tx,
      currentLeave,
      proposedStartDate,
      proposedEndDate,
      count,
      actionByUserId,
      currentProposal.message || "Accepted proposed leave dates",
    );

    return { leaveRequest: approved, threadMessage: acceptance };
  });
}

export async function acceptMyLeaveThreadProposal(
  userId,
  leaveRequestId,
  messageId,
) {
  const leave = await getEmployeeLeaveRequest(userId, leaveRequestId);
  ensurePendingLeave(leave);
  const proposal = await getProposalMessage(leaveRequestId, messageId);

  return acceptLeaveProposal({
    leave,
    proposal,
    acceptedByUserId: userId,
    actionByUserId: proposal.actorUserId,
  });
}

export async function acceptLeaveThreadProposalWeb(
  callerRoles,
  callerId,
  leaveRequestId,
  messageId,
) {
  const leave = await getScopedWebLeaveRequest(
    callerRoles,
    callerId,
    leaveRequestId,
  );
  ensurePendingLeave(leave);
  const proposal = await getProposalMessage(leaveRequestId, messageId);
  if (proposal.actorUserId !== leave.userId) {
    throw new ForbiddenError("Managers can only accept employee proposals");
  }

  return acceptLeaveProposal({
    leave,
    proposal,
    acceptedByUserId: callerId,
    actionByUserId: callerId,
  });
}
//# sourceMappingURL=leaves.service.js.map
