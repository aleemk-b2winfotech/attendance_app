import { Role } from "@prisma/client";
import { ForbiddenError } from "./errors.js";

const ROLE_RANK = {
  [Role.EMPLOYEE]: 1,
  [Role.MANAGER]: 2,
  [Role.ADMIN]: 3,
};

export function getEffectiveRoles(role) {
  if (role === Role.ADMIN) {
    return [Role.EMPLOYEE, Role.ADMIN];
  }
  if (role === Role.MANAGER) {
    return [Role.EMPLOYEE, Role.MANAGER];
  }
  return [Role.EMPLOYEE];
}

export function roleFromRoles(roles = []) {
  if (roles.includes(Role.ADMIN)) {
    return Role.ADMIN;
  }
  if (roles.includes(Role.MANAGER)) {
    return Role.MANAGER;
  }
  return null;
}

export function roleFromEffectiveRolesOrRole(data = {}) {
  if (Object.prototype.hasOwnProperty.call(data, "role")) {
    return data.role === Role.EMPLOYEE ? null : data.role;
  }
  if (Array.isArray(data.roles)) {
    return roleFromRoles(data.roles);
  }
  return undefined;
}

export function highestRoleFromRoles(roles = []) {
  return roleFromRoles(roles);
}

export function roleRank(role) {
  return ROLE_RANK[role] ?? ROLE_RANK[Role.EMPLOYEE];
}

export function canAssignRole(callerRoles, targetRole) {
  return roleRank(targetRole) <= roleRank(highestRoleFromRoles(callerRoles));
}

export function assertCanAssignRole(callerRoles, targetRole) {
  if (!canAssignRole(callerRoles, targetRole)) {
    throw new ForbiddenError("Cannot assign a role higher than your own");
  }
}

export function isAdminRole(role) {
  return role === Role.ADMIN;
}

export function nonAdminUserWhere() {
  return {
    OR: [
      { role: null },
      { role: Role.EMPLOYEE },
      { role: Role.MANAGER },
    ],
  };
}

export function appendNonAdminUserFilter(where) {
  where.AND = [...(where.AND || []), nonAdminUserWhere()];
  return where;
}

export function withEffectiveRoles(user) {
  if (!user || typeof user !== "object") {
    return user;
  }
  const { role, ...rest } = user;
  return {
    ...rest,
    roles: getEffectiveRoles(role),
  };
}

export function withEffectiveRolesMany(users = []) {
  return users.map((user) => withEffectiveRoles(user));
}
