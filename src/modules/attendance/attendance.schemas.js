import { z } from 'zod';
const optionalTrimmedString = z.preprocess((value) => {
    if (typeof value !== 'string') {
        return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const attendanceRecordStatusSchema = z.enum([
    'present',
    'halfDay',
    'absent',
    'working',
    'onLeave',
    'holiday',
    'weeklyOff',
    'regularized',
]);
function validateDateRange(schema) {
    return schema.refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
        path: ['endDate'],
        message: 'endDate must be on or after startDate',
    });
}
export const punchInSchema = z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    todayPlan: optionalTrimmedString,
}).refine((value) => (value.latitude == null) === (value.longitude == null), {
    path: ['longitude'],
    message: 'latitude and longitude must be provided together',
});
export const punchOutSchema = z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    report: optionalTrimmedString,
}).refine((value) => (value.latitude == null) === (value.longitude == null), {
    path: ['longitude'],
    message: 'latitude and longitude must be provided together',
}).default({});
export const attendanceOverviewQuerySchema = validateDateRange(z.object({
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    // Supports `?includeHolidayHistory=true`; any non-"true" value becomes false.
    includeHolidayHistory: z.preprocess((v) => v === 'true', z.boolean().default(false)),
}).strict());
export const webAttendanceOverviewQuerySchema = validateDateRange(z.object({
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    search: optionalTrimmedString,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict());
export const webAttendanceRecordsQuerySchema = validateDateRange(z.object({
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    status: attendanceRecordStatusSchema.optional(),
    search: optionalTrimmedString,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict());
export const regularizationSchema = z.object({
    overrideStatus: z.enum(['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE']),
    overridePunchInAt: z.string().datetime().optional(),
    overridePunchOutAt: z.string().datetime().optional(),
    reason: z.string().min(1),
});
//# sourceMappingURL=attendance.schemas.js.map
