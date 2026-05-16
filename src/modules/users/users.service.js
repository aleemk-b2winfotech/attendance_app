import { Role } from "@prisma/client";
import { getPrisma } from "../../config/database.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  buildManagerScopeWhere,
  assertDirectReportAccess,
  isManagerScoped,
  roleFromEffectiveRolesOrRole,
  assertCanAssignRole,
  roleRank,
  withEffectiveRoles,
  withEffectiveRolesMany,
} from "../../common/index.js";
import { paginate, paginationMeta } from "../../common/pagination.js";
import { env } from "../../config/env.js";

function applyRoleFilter(where, role) {
  if (!role) {
    return;
  }
  if (role === Role.EMPLOYEE) {
    where.AND = [
      ...(where.AND || []),
      { OR: [{ role: null }, { role: Role.EMPLOYEE }] },
    ];
    return;
  }
  where.role = role;
}

function getRequestedRole(data) {
  return roleFromEffectiveRolesOrRole(data);
}

function assertRoleAssignable(callerRoles, targetRole) {
  assertCanAssignRole(callerRoles, targetRole);
}

function assertRoleCanOnlyGrow(currentRole, requestedRole) {
  if (roleRank(requestedRole) < roleRank(currentRole)) {
    throw new BadRequestError("Role can only be promoted, not downgraded");
  }
}

async function assertValidManager(managerUserId) {
  if (!managerUserId) {
    return;
  }

  const prisma = getPrisma();
  const manager = await prisma.user.findUnique({
    where: { id: managerUserId },
  });
  if (!manager || manager.role !== Role.MANAGER) {
    throw new BadRequestError("Invalid manager user ID");
  }
}

/**
 * Lists users visible to caller with optional search/role/activity filters.
 *
 * Authorization scope:
 * - ADMIN: all users, including admins
 * - MANAGER (non-admin): direct non-admin reports only
 */
export async function listUsers(callerRoles, callerId, filters) {
  const prisma = getPrisma();
  const where = {};

  Object.assign(where, buildManagerScopeWhere(callerRoles, callerId));

  if (filters.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  applyRoleFilter(where, filters.role);
  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        managerUserId: true,
        manager: { select: { id: true, fullName: true } },
        createdAt: true,
      },
      orderBy: { fullName: "asc" },
      ...paginate(filters.page, filters.limit),
    }),
  ]);
  return {
    items: withEffectiveRolesMany(users),
    meta: paginationMeta(total, filters.page, filters.limit),
  };
}

/**
 * Creates a user and its initial attendance profile.
 *
 * Guardrails:
 * - role arrays are converted to nullable privilege role
 * - callers cannot assign a role above their own
 * - managers can create only direct reports up to their own role
 * - email uniqueness enforced
 * - managerUserId (if given) must reference a manager
 */
export async function createUser(callerRoles, callerId, data) {
  const prisma = getPrisma();
  const requestedRole = getRequestedRole(data) ?? null;

  assertRoleAssignable(callerRoles, requestedRole);

  if (isManagerScoped(callerRoles)) {
    data.managerUserId = callerId;
  }

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existing) throw new ConflictError("Email already registered");

  const managerUserId =
    requestedRole === Role.ADMIN ? null : data.managerUserId || null;

  await assertValidManager(managerUserId);

  const emailDomain = data.email.split("@")[1];
  if (emailDomain !== env().COMPANY_DOMAIN) {
    throw new BadRequestError(`Email must be of domain ${env().COMPANY_DOMAIN}`);
  }

  const user = await prisma.user.create({
    data: {
      fullName: data.fullName,
      email: data.email,
      role: requestedRole,
      managerUserId,
    },
    include: { manager: { select: { id: true, fullName: true } } },
  });
  await prisma.attendanceProfile.create({ data: { userId: user.id } });
  return withEffectiveRoles(user);
}

/**
 * Updates mutable user fields with role/scope restrictions.
 *
 * Manager limitations:
 * - can update only direct reports
 * - cannot reassign manager
 * - cannot assign admin
 */
export async function updateUser(callerRoles, callerId, userId, data) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User");

  if (isManagerScoped(callerRoles)) {
    assertDirectReportAccess(callerRoles, callerId, user, "update");
    if (data.managerUserId !== undefined) {
      throw new ForbiddenError("Managers cannot reassign manager");
    }
  }

  const requestedRole = getRequestedRole(data);
  if (requestedRole !== undefined) {
    assertRoleAssignable(callerRoles, requestedRole);
    assertRoleCanOnlyGrow(user.role, requestedRole);
  }

  const resultingRole = requestedRole === undefined ? user.role : requestedRole;
  const managerUserId =
    resultingRole === Role.ADMIN
      ? null
      : data.managerUserId;

  if (managerUserId) {
    await assertValidManager(managerUserId);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(requestedRole !== undefined && { role: requestedRole }),
      ...((data.managerUserId !== undefined || resultingRole === Role.ADMIN) && {
        managerUserId,
      }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    include: { manager: { select: { id: true, fullName: true } } },
  });
  return withEffectiveRoles(updated);
}

/**
 * Returns attendance profile for a user, creating one if missing.
 * Auto-create keeps older data migrations from breaking profile UI.
 */
export async function getAttendanceProfile(callerRoles, callerId, userId) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User");
  assertDirectReportAccess(callerRoles, callerId, user, "view");

  let profile = await prisma.attendanceProfile.findUnique({
    where: { userId },
    include: { updatedBy: { select: { id: true, fullName: true } } },
  });
  if (!profile) {
    profile = await prisma.attendanceProfile.create({
      data: { userId },
      include: { updatedBy: { select: { id: true, fullName: true } } },
    });
  }
  return profile;
}

/**
 * Upserts attendance/geofence profile.
 * `updatedByUserId` is tracked for audit visibility.
 */
export async function updateAttendanceProfile(
  callerRoles,
  callerId,
  userId,
  data,
) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User");
  assertDirectReportAccess(callerRoles, callerId, user, "update");

  return prisma.attendanceProfile.upsert({
    where: { userId },
    create: {
      userId,
      officeLatitude: data.officeLatitude,
      officeLongitude: data.officeLongitude,
      officeRadiusMeters: data.officeRadiusMeters,
      updatedByUserId: callerId,
    },
    update: {
      officeLatitude: data.officeLatitude,
      officeLongitude: data.officeLongitude,
      officeRadiusMeters: data.officeRadiusMeters,
      updatedByUserId: callerId,
    },
    include: { updatedBy: { select: { id: true, fullName: true } } },
  });
}

/**
 * Returns profile for currently authenticated user.
 * Includes manager summary and essential attendance profile fields.
 */
export async function getMyProfile(userId) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: { select: { id: true, fullName: true, email: true } },
      attendanceProfile: {
        select: {
          boundDeviceId: true,
          officeLatitude: true,
          officeLongitude: true,
          officeRadiusMeters: true,
        },
      },
    },
  });
  if (!user) throw new NotFoundError("User");
  return withEffectiveRoles(user);
}
