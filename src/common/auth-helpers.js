import { Role } from "@prisma/client";
import { ForbiddenError } from "./errors.js";

/**
 * Checks if caller has manager-only scope (manager but not admin).
 * @param {Role[]} callerRoles
 * @returns {boolean}
 */
export function isManagerScoped(callerRoles) {
  return callerRoles.includes(Role.MANAGER) && !callerRoles.includes(Role.ADMIN);
}

/**
 * Asserts that target user is a direct report of the caller.
 * Throws ForbiddenError if caller is manager-scoped and target is not their report.
 *
 * @param {Role[]} callerRoles - Roles of the authenticated user
 * @param {string} callerId - ID of the authenticated user
 * @param {object} targetUser - User object with managerUserId
 * @param {string} [action='access'] - Action description for error message
 * @throws {ForbiddenError}
 */
export function assertDirectReportAccess(callerRoles, callerId, targetUser, action = 'access') {
  if (isManagerScoped(callerRoles) && targetUser.managerUserId !== callerId) {
    throw new ForbiddenError(`You can only ${action} your direct reports`);
  }
}

/**
 * Builds Prisma where clause for manager-scoped queries.
 * Returns constraint object to spread into where clause.
 *
 * @param {Role[]} callerRoles
 * @param {string} callerId
 * @returns {object} Where clause fragment
 */
export function buildManagerScopeWhere(callerRoles, callerId) {
  if (isManagerScoped(callerRoles)) {
    return { managerUserId: callerId };
  }
  return {};
}

/**
 * Builds nested user relation where for manager-scoped queries.
 * Used when filtering on a related user entity.
 *
 * @param {Role[]} callerRoles
 * @param {string} callerId
 * @returns {object} User relation where clause fragment
 */
export function buildManagerScopeUserWhere(callerRoles, callerId) {
  if (isManagerScoped(callerRoles)) {
    return { user: { managerUserId: callerId } };
  }
  return {};
}
