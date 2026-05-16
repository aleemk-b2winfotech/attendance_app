import { HolidayChangeType } from '@prisma/client';
import { getPrisma } from '../../config/database.js';
import { BadRequestError, ConflictError, NotFoundError, } from '../../common/errors.js';
import { businessNow, businessToday, toDateString } from '../../common/index.js';
import { rebuildSummariesForDateRange } from '../attendance/attendance-summary.service.js';
// Normalized snapshot stored in change logs for audit/history visibility.
function holidaySnapshot(h) {
    return {
        title: h.title,
        description: h.description,
        startDate: toDateString(h.startDate),
        endDate: toDateString(h.endDate),
        isDeleted: h.isDeleted,
    };
}
async function checkOverlap(startDate, endDate, excludeId) {
    const prisma = getPrisma();
    const where = {
        isDeleted: false,
        startDate: { lte: new Date(endDate) },
        endDate: { gte: new Date(startDate) },
    };
    if (excludeId) {
        where.id = { not: excludeId };
    }
    const overlap = await prisma.holiday.findFirst({ where });
    if (overlap) {
        throw new ConflictError(`Overlaps with existing holiday: ${overlap.title}`);
    }
}
function mergeDateRangeBounds(startA, endA, startB, endB) {
    const dates = [startA, endA, startB, endB].map((value) => toDateString(value));
    return {
        startDate: dates.reduce((min, value) => value < min ? value : min),
        endDate: dates.reduce((max, value) => value > max ? value : max),
    };
}
function currentBusinessYearBounds() {
    const now = businessNow();
    return {
        startDate: now.startOf('year').toISODate(),
        endDate: now.endOf('year').toISODate(),
    };
}
function employeeHolidayPayload(holiday) {
    return {
        id: holiday.id,
        title: holiday.title,
        description: holiday.description,
        startDate: toDateString(holiday.startDate),
        endDate: toDateString(holiday.endDate),
    };
}
/**
 * Creates a holiday and writes an audit log snapshot.
 * Overlap with existing active holidays is blocked.
 */
export async function createHoliday(callerId, data) {
    const prisma = getPrisma();
    if (data.startDate > data.endDate) {
        throw new BadRequestError('startDate must be <= endDate');
    }
    const today = businessToday();
    if (data.startDate < today || data.endDate < today) {
        throw new BadRequestError('Holiday dates cannot be in the past');
    }
    await checkOverlap(data.startDate, data.endDate);
    return prisma.$transaction(async (tx) => {
        const holiday = await tx.holiday.create({
            data: {
                title: data.title,
                description: data.description || null,
                startDate: new Date(data.startDate),
                endDate: new Date(data.endDate),
                createdByUserId: callerId,
            },
        });
        // Immutable audit trail for timeline/history APIs.
        // Audit entry stores "after" state for deterministic history rendering.
        await tx.holidayChangeLog.create({
            data: {
                holidayId: holiday.id,
                changeType: HolidayChangeType.CREATED,
                reason: 'Initial creation',
                changedByUserId: callerId,
                snapshotAfter: holidaySnapshot(holiday),
            },
        });
        await rebuildSummariesForDateRange(data.startDate, data.endDate, tx);
        return holiday;
    });
}
/**
 * Updates future holidays only.
 *
 * Constraints:
 * - started holidays are immutable
 * - updated date range must remain non-overlapping
 * - reason is required and stored in change history
 */
export async function updateHoliday(callerId, holidayId, data) {
    const prisma = getPrisma();
    const holiday = await prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday || holiday.isDeleted)
        throw new NotFoundError('Holiday');
    // Block edits once holiday has started to keep attendance calculations stable.
    const today = businessToday();
    if (today >= toDateString(holiday.startDate)) {
        throw new BadRequestError('Cannot update a holiday that has already started');
    }
    const newStart = data.startDate || toDateString(holiday.startDate);
    const newEnd = data.endDate || toDateString(holiday.endDate);
    if (newStart > newEnd)
        throw new BadRequestError('startDate must be <= endDate');
    if (newStart < today || newEnd < today) {
        throw new BadRequestError('Holiday dates cannot be in the past');
    }
    await checkOverlap(newStart, newEnd, holidayId);
    // Capture pre-change snapshot for audit diff views.
    const before = holidaySnapshot(holiday);
    return prisma.$transaction(async (tx) => {
        const updated = await tx.holiday.update({
            where: { id: holidayId },
            data: {
                ...(data.title !== undefined && { title: data.title }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.startDate !== undefined && { startDate: new Date(data.startDate) }),
                ...(data.endDate !== undefined && { endDate: new Date(data.endDate) }),
                updatedByUserId: callerId,
            },
        });
        await tx.holidayChangeLog.create({
            data: {
                holidayId: holiday.id,
                changeType: HolidayChangeType.UPDATED,
                reason: data.reason,
                changedByUserId: callerId,
                snapshotBefore: before,
                snapshotAfter: holidaySnapshot(updated),
            },
        });
        const affectedRange = mergeDateRangeBounds(holiday.startDate, holiday.endDate, newStart, newEnd);
        await rebuildSummariesForDateRange(affectedRange.startDate, affectedRange.endDate, tx);
        return updated;
    });
}
/**
 * Soft deletes a future holiday and records deletion reason.
 */
export async function deleteHoliday(callerId, holidayId, reason) {
    const prisma = getPrisma();
    const holiday = await prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday || holiday.isDeleted)
        throw new NotFoundError('Holiday');
    const today = businessToday();
    if (today >= toDateString(holiday.startDate)) {
        throw new BadRequestError('Cannot delete a holiday that has already started');
    }
    const before = holidaySnapshot(holiday);
    // Soft-delete preserves historic references and auditability.
    return prisma.$transaction(async (tx) => {
        await tx.holiday.update({
            where: { id: holidayId },
            data: { isDeleted: true, updatedByUserId: callerId },
        });
        await tx.holidayChangeLog.create({
            data: {
                holidayId: holiday.id,
                changeType: HolidayChangeType.DELETED,
                reason,
                changedByUserId: callerId,
                snapshotBefore: before,
            },
        });
        await rebuildSummariesForDateRange(holiday.startDate, holiday.endDate, tx);
        return { deleted: true };
    });
}
/**
 * Lists holidays in a date window.
 * Optional `includeDeleted` supports audit/admin screens.
 */
export async function listHolidays(filters) {
    const prisma = getPrisma();
    const where = {};
    if (!filters.includeDeleted) {
        where.isDeleted = false;
    }
    if (filters.startDate) {
        where.endDate = { gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
        where.startDate = { ...(where.startDate || {}), lte: new Date(filters.endDate) };
    }
    return prisma.holiday.findMany({
        where,
        orderBy: { startDate: 'asc' },
        include: {
            createdBy: { select: { id: true, fullName: true } },
            updatedBy: { select: { id: true, fullName: true } },
        },
    });
}
/**
 * Lists active holidays for the authenticated mobile employee.
 *
 * Holidays are currently company-wide, so the employee id scopes access through
 * mobile authentication rather than through a holiday assignment table.
 */
export async function listEmployeeHolidays(_employeeUserId, filters) {
    const prisma = getPrisma();
    const defaults = currentBusinessYearBounds();
    const startDate = filters.startDate || defaults.startDate;
    const endDate = filters.endDate || defaults.endDate;
    const today = businessToday();
    const where = {
        isDeleted: false,
        endDate: { gte: new Date(startDate) },
        startDate: { lte: new Date(endDate) },
    };
    if (filters.filter === 'future') {
        where.endDate = { ...where.endDate, gte: new Date(today) };
    }
    if (filters.filter === 'past') {
        where.endDate = { ...where.endDate, lt: new Date(today) };
    }
    const holidays = await prisma.holiday.findMany({
        where,
        orderBy: { startDate: filters.filter === 'past' ? 'desc' : 'asc' },
        select: {
            id: true,
            title: true,
            description: true,
            startDate: true,
            endDate: true,
        },
    });
    return holidays.map(employeeHolidayPayload);
}
/**
 * Returns holiday change log timeline, newest first.
 */
export async function getHolidayHistory(holidayId) {
    const prisma = getPrisma();
    const holiday = await prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday)
        throw new NotFoundError('Holiday');
    return prisma.holidayChangeLog.findMany({
        where: { holidayId },
        orderBy: { changedAt: 'desc' },
        include: {
            changedBy: { select: { id: true, fullName: true } },
        },
    });
}
//# sourceMappingURL=holidays.service.js.map
