import { z } from 'zod';
// Mobile login also needs device identity to enforce bound-device policy.
export const googleLoginMobileSchema = z.object({
    googleToken: z.string().min(1),
    deviceId: z.string().min(1),
});
export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1),
});
// Public fallback endpoint for requesting device switch via fresh Google auth.
export const deviceChangeRequestSchema = z.object({
    googleToken: z.string().min(1),
    deviceId: z.string().min(1),
    reason: z.string().min(1),
});
//# sourceMappingURL=auth.schemas.js.map
