import { z } from 'zod';
// Employee-submitted payload to request rebinding mobile attendance device.
export const createDeviceChangeSchema = z.object({
    requestedDeviceId: z.string().min(1),
    reason: z.string().min(1),
});
export const deviceChangeActionSchema = z.object({
    actionNote: z.string().optional(),
});
export const deviceChangeRejectSchema = z.object({
    actionNote: z.string().min(1),
});
export const listDeviceChangeQuerySchema = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const userDeviceChangeLogsQuerySchema = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
//# sourceMappingURL=device-changes.schemas.js.map
