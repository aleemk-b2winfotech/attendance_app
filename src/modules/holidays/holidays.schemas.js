import { z } from 'zod';
import { DateTime } from 'luxon';
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => DateTime.fromISO(value, { zone: 'utc' }).isValid, {
    message: 'Invalid date',
});
// Holiday create/update payload schemas.
export const createHolidaySchema = z.object({
    title: z.string().min(1).max(120),
    description: z.string().optional(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
});
export const updateHolidaySchema = z.object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().nullable().optional(),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    reason: z.string().min(1),
});
export const deleteHolidaySchema = z.object({
    reason: z.string().min(1),
});
export const listHolidaysQuerySchema = z.object({
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    includeDeleted: z.preprocess((v) => v === 'true', z.boolean().default(false)),
});
export const listEmployeeHolidaysQuerySchema = z.object({
    filter: z.enum(['all', 'future', 'past']).default('all'),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
}).strict().refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    path: ['endDate'],
    message: 'endDate must be on or after startDate',
});
//# sourceMappingURL=holidays.schemas.js.map
