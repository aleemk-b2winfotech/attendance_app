import { z } from 'zod';
// Date strings stay in YYYY-MM-DD to align with business timezone day-based logic.
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalTrimmedString = z.preprocess((value) => {
    if (typeof value !== 'string') {
        return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

export const createLeaveRequestSchema = z.object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    reason: z.string().min(1),
});
export const leaveActionSchema = z.object({
    actionNote: z.string().optional(),
});
export const leaveRejectSchema = z.object({
    actionNote: z.string().min(1),
});
export const listLeaveRequestsQuerySchema = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const leaveThreadMessageSchema = z.object({
    message: optionalTrimmedString,
    proposedStartDate: dateOnlySchema.optional(),
    proposedEndDate: dateOnlySchema.optional(),
}).refine((value) => {
    const hasStart = Boolean(value.proposedStartDate);
    const hasEnd = Boolean(value.proposedEndDate);
    return hasStart === hasEnd;
}, {
    path: ['proposedEndDate'],
    message: 'Both proposedStartDate and proposedEndDate are required for a proposal',
}).refine((value) => {
    if (!value.proposedStartDate && !value.proposedEndDate) {
        return Boolean(value.message);
    }
    return true;
}, {
    path: ['message'],
    message: 'message is required for comments',
}).refine((value) => {
    if (!value.proposedStartDate || !value.proposedEndDate) {
        return true;
    }
    return value.proposedStartDate <= value.proposedEndDate;
}, {
    path: ['proposedEndDate'],
    message: 'proposedEndDate must be on or after proposedStartDate',
});
//# sourceMappingURL=leaves.schemas.js.map
