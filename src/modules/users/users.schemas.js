import { z } from 'zod';
import { Role } from '@prisma/client';
// Email is normalized to lowercase before persistence/lookup.
export const createUserSchema = z.object({
    fullName: z.string().min(1).max(120),
    email: z.string().email().max(150).transform((v) => v.toLowerCase()),
    roles: z.array(z.nativeEnum(Role)).min(1).optional(),
    role: z.nativeEnum(Role).nullable().optional(),
    managerUserId: z.string().uuid().nullable().optional(),
}).refine((data) => data.roles || Object.prototype.hasOwnProperty.call(data, 'role'), {
    message: 'roles or role is required',
});
export const updateUserSchema = z.object({
    fullName: z.string().min(1).max(120).optional(),
    roles: z.array(z.nativeEnum(Role)).min(1).optional(),
    role: z.nativeEnum(Role).nullable().optional(),
    managerUserId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
});
export const listUsersQuerySchema = z.object({
    search: z.string().optional(),
    role: z.nativeEnum(Role).optional(),
    // Query params arrive as strings; preprocess converts explicit booleans.
    isActive: z.preprocess((v) => {
        if (v === 'true')
            return true;
        if (v === 'false')
            return false;
        return v;
    }, z.boolean().optional()),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const attendanceProfileSchema = z.object({
    officeLatitude: z.number().min(-90).max(90),
    officeLongitude: z.number().min(-180).max(180),
    officeRadiusMeters: z.number().int().min(1).max(10000),
});
//# sourceMappingURL=users.schemas.js.map
