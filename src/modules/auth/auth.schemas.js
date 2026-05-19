import { z } from 'zod';
// Flutter-native login supports employee attendance and admin management modes.
export const googleLoginMobileSchema = z.discriminatedUnion('portal', [
    z.object({
        googleToken: z.string().min(1),
        portal: z.literal('employee'),
        deviceId: z.string().min(1),
    }),
    z.object({
        googleToken: z.string().min(1),
        portal: z.literal('admin'),
    }),
]);
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
