import { DeviceChangeStatus } from '@prisma/client';
import { getPrisma } from '../../config/database.js';
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    buildManagerScopeUserWhere,
    assertDirectReportAccess,
} from '../../common/index.js';
import { paginate, paginationMeta } from '../../common/pagination.js';
/**
 * Employee creates a device change request.
 * Any previous pending request is auto-closed (rejected) to avoid multiple active approvals.
 */
export async function createDeviceChangeRequest(userId, data) {
    const prisma = getPrisma();
    const profile = await prisma.attendanceProfile.findUnique({ where: { userId } });
    // Keep at most one pending request per employee to simplify approval workflow.
    await prisma.deviceChangeRequest.updateMany({
        where: { userId, status: DeviceChangeStatus.PENDING },
        data: { status: DeviceChangeStatus.REJECTED, actionAt: new Date(), actionNote: 'Replaced by new request' },
    });
    return prisma.deviceChangeRequest.create({
        data: {
            userId,
            currentDeviceIdSnapshot: profile?.boundDeviceId || null,
            requestedDeviceId: data.requestedDeviceId,
            reason: data.reason,
            status: DeviceChangeStatus.PENDING,
        },
    });
}
/**
 * Employee self-view of own device change requests.
 */
export async function getMyDeviceChangeRequests(userId, filters) {
    const prisma = getPrisma();
    const where = { userId };
    if (filters.status)
        where.status = filters.status;
    const [total, items] = await Promise.all([
        prisma.deviceChangeRequest.count({ where }),
        prisma.deviceChangeRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { actionBy: { select: { id: true, fullName: true } } },
            ...paginate(filters.page, filters.limit),
        }),
    ]);
    return { items, meta: paginationMeta(total, filters.page, filters.limit) };
}
/**
 * Manager/admin list endpoint.
 * Managers are constrained to direct reports only.
 */
export async function listDeviceChangeRequestsWeb(callerRoles, callerId, filters) {
    const prisma = getPrisma();
    const where = {};
    // Managers can review only direct-report requests; admins can review all.
    Object.assign(where, buildManagerScopeUserWhere(callerRoles, callerId));
    if (filters.status)
        where.status = filters.status;
    if (filters.search) {
        where.user = {
            ...where.user,
            OR: [
                { fullName: { contains: filters.search, mode: 'insensitive' } },
                { email: { contains: filters.search, mode: 'insensitive' } },
            ],
        };
    }
    const [total, items] = await Promise.all([
        prisma.deviceChangeRequest.count({ where }),
        prisma.deviceChangeRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
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
 * Approves a pending device change request.
 *
 * Side effects in same transaction:
 * - mark request approved
 * - rebind user's attendance profile device
 * - revoke all active MOBILE refresh tokens
 */
export async function approveDeviceChange(callerRoles, callerId, requestId, actionNote) {
    const prisma = getPrisma();
    const dcr = await prisma.deviceChangeRequest.findUnique({
        where: { id: requestId },
        include: { user: true },
    });
    if (!dcr)
        throw new NotFoundError('Device change request');
    if (dcr.status !== DeviceChangeStatus.PENDING) {
        throw new BadRequestError('Only pending requests can be approved');
    }
    if (dcr.userId === callerId) {
        throw new ForbiddenError('Cannot approve your own device change request');
    }
    assertDirectReportAccess(callerRoles, callerId, dcr.user, 'approve direct reports\' requests');
    /**
     * Transaction ensures device approval state, bound device update, and token revocation
     * are committed atomically.
     */
    // Imported helper intentionally not used; tx-local query keeps all side effects atomic.
    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.deviceChangeRequest.update({
            where: { id: requestId },
            data: {
                status: DeviceChangeStatus.APPROVED,
                actionByUserId: callerId,
                actionAt: new Date(),
                actionNote: actionNote || null,
            },
            include: {
                user: { select: { id: true, fullName: true } },
                actionBy: { select: { id: true, fullName: true } },
            },
        });
        await tx.attendanceProfile.upsert({
            where: { userId: dcr.userId },
            create: { userId: dcr.userId, boundDeviceId: dcr.requestedDeviceId, updatedByUserId: callerId },
            update: { boundDeviceId: dcr.requestedDeviceId, updatedByUserId: callerId },
        });
        // Force re-authentication on newly approved device.
        await tx.refreshToken.updateMany({
            where: { userId: dcr.userId, portal: 'MOBILE', revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return updated;
    });
    return result;
}
/**
 * Rejects a pending device change request with mandatory note.
 */
export async function rejectDeviceChange(callerRoles, callerId, requestId, actionNote) {
    const prisma = getPrisma();
    const dcr = await prisma.deviceChangeRequest.findUnique({
        where: { id: requestId },
        include: { user: true },
    });
    if (!dcr)
        throw new NotFoundError('Device change request');
    if (dcr.status !== DeviceChangeStatus.PENDING) {
        throw new BadRequestError('Only pending requests can be rejected');
    }
    if (dcr.userId === callerId) {
        throw new ForbiddenError('Cannot reject your own device change request');
    }
    assertDirectReportAccess(callerRoles, callerId, dcr.user, 'reject direct reports\' requests');
    return prisma.deviceChangeRequest.update({
        where: { id: requestId },
        data: {
            status: DeviceChangeStatus.REJECTED,
            actionByUserId: callerId,
            actionAt: new Date(),
            actionNote,
        },
        include: {
            user: { select: { id: true, fullName: true } },
            actionBy: { select: { id: true, fullName: true } },
        },
    });
}
//# sourceMappingURL=device-changes.service.js.map
