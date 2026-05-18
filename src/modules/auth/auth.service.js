import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Portal, Role } from '@prisma/client';
import { env } from '../../config/env.js';
import { getPrisma } from '../../config/database.js';
import { UnauthorizedError, ForbiddenError } from '../../common/errors.js';
import { getEffectiveRoles } from '../../common/role-helpers.js';
// We never store raw refresh tokens; only deterministic SHA-256 hashes.
function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
/**
 * Parses compact duration strings used in env (`15m`, `7d`, ...).
 * Falls back to 15 minutes if malformed to keep token creation resilient.
 */
function parseDuration(dur) {
    const match = dur.match(/^(\d+)([smhd])$/);
    if (!match)
        return 900; // default 15m
    const val = parseInt(match[1], 10);
    switch (match[2]) {
        case 's': return val;
        case 'm': return val * 60;
        case 'h': return val * 3600;
        case 'd': return val * 86400;
        default: return 900;
    }
}
function signAccessToken(userId, email, role, portal) {
    const roles = getEffectiveRoles(role);
    const payload = {
        sub: userId,
        email,
        roles,
        portal,
    };
    return jwt.sign(payload, env().JWT_ACCESS_SECRET, {
        expiresIn: parseDuration(env().JWT_ACCESS_TTL),
    });
}
async function createRefreshToken(userId, portal) {
    const prisma = getPrisma();
    const raw = randomBytes(48).toString('hex');
    const hashed = hashToken(raw);
    const ttlSeconds = parseDuration(env().JWT_REFRESH_TTL);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await prisma.$transaction([
        prisma.refreshToken.deleteMany({ where: { userId, portal } }),
        prisma.refreshToken.create({
            data: { userId, portal, tokenHash: hashed, expiresAt },
        }),
    ]);
    /**
     * Token format is base64url(JSON) containing userId/portal/rawToken.
     * This is opaque to clients but lets us validate DB ownership and portal match.
     */
    const tokenPayload = Buffer.from(JSON.stringify({ userId, portal, token: raw })).toString('base64url');
    return tokenPayload;
}
/**
 * Verifies a Google ID token against the expected OAuth client ID.
 * This enforces portal-specific client audiences and prevents token reuse from
 * unrelated apps.
 */
async function verifyGoogleToken(idToken, clientId) {
    try {
        const client = new OAuth2Client(clientId);
        const ticket = await client.verifyIdToken({
            idToken,
            audience: clientId,
        });
        const payload = ticket.getPayload();
        if (!payload?.email)
            throw new UnauthorizedError('Invalid Google token');
        // Normalize email casing once so DB lookups are stable.
        return { email: payload.email.toLowerCase(), name: payload.name || '' };
    }
    catch (err) {
        if (err instanceof UnauthorizedError)
            throw err;
        throw new UnauthorizedError('Google token verification failed');
    }
}
function portalAllowedForRoles(portal, roles) {
    if (portal === Portal.MOBILE) {
        return roles.includes(Role.EMPLOYEE);
    }
    // WEB portal
    return roles.includes(Role.MANAGER) || roles.includes(Role.ADMIN);
}
/**
 * Mobile login flow.
 *
 * Rules enforced:
 * 1) Google token must be valid and company-domain scoped
 * 2) user must exist and be active
 * 3) user must have a role allowed on MOBILE portal (EMPLOYEE)
 * 4) device-binding policy must pass (first bind or exact match)
 *
 * Returns signed access token + rotated refresh token + minimal user profile.
 */
export async function loginMobile(googleToken, deviceId) {
    const e = env();
    const google = await verifyGoogleToken(googleToken, e.GOOGLE_WEB_CLIENT_ID);
    // Strict domain allow-list to keep authentication enterprise-scoped.
    const domain = google.email.split('@')[1];
    if (domain !== e.COMPANY_DOMAIN) {
        throw new ForbiddenError('Email domain not allowed');
    }
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
        where: { email: google.email },
        include: { attendanceProfile: true },
    });
    // User must be provisioned in internal DB; Google account alone is insufficient.
    if (!user || !user.isActive) {
        throw new UnauthorizedError('User not found or inactive');
    }
    // Role/portal compatibility check (defense in depth on top of route middleware).
    const roles = getEffectiveRoles(user.role);
    if (!portalAllowedForRoles(Portal.MOBILE, roles)) {
        throw new ForbiddenError('Your role does not allow mobile portal access');
    }
    /**
     * Device binding policy:
     * - first mobile login binds a device
     * - subsequent logins must use the same device
     * - device swaps go through manager/admin approval workflow
     */
    if (!user.attendanceProfile) {
        // Create attendance profile with bound device
        await prisma.attendanceProfile.create({
            data: { userId: user.id, boundDeviceId: deviceId },
        });
    }
    else if (!user.attendanceProfile.boundDeviceId) {
        // First login binds device
        await prisma.attendanceProfile.update({
            where: { userId: user.id },
            data: { boundDeviceId: deviceId },
        });
    }
    else if (user.attendanceProfile.boundDeviceId !== deviceId) {
        throw new ForbiddenError('Device mismatch. Please request a device change.');
    }
    // Issue short-lived bearer token and longer-lived revocable session token.
    const accessToken = signAccessToken(user.id, user.email, user.role, Portal.MOBILE);
    const refreshToken = await createRefreshToken(user.id, Portal.MOBILE);
    return {
        accessToken,
        refreshToken,
        user: {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            roles,
        },
    };
}
/**
 * Web login flow.
 *
 * Similar to mobile login but with portal-role policy:
 * WEB requires MANAGER or ADMIN role.
 */
export async function loginWeb(googleToken) {
    const e = env();
    const google = await verifyGoogleToken(googleToken, e.GOOGLE_WEB_CLIENT_ID);
    const domain = google.email.split('@')[1];
    if (domain !== e.COMPANY_DOMAIN) {
        throw new ForbiddenError('Email domain not allowed');
    }
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { email: google.email } });
    if (!user || !user.isActive) {
        throw new UnauthorizedError('User not found or inactive');
    }
    const roles = getEffectiveRoles(user.role);
    if (!portalAllowedForRoles(Portal.WEB, roles)) {
        throw new ForbiddenError('Your role does not allow web portal access');
    }
    const accessToken = signAccessToken(user.id, user.email, user.role, Portal.WEB);
    const refreshToken = await createRefreshToken(user.id, Portal.WEB);
    return {
        accessToken,
        refreshToken,
        user: {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            roles,
        },
    };
}
/**
 * Refresh token rotation endpoint.
 *
 * Steps:
 * 1) decode opaque refresh token payload
 * 2) hash raw token and locate DB record
 * 3) verify not revoked/expired and ownership matches payload
 * 4) verify user is still active
 * 5) revoke old token and mint a new pair
 */
export async function refreshAccessToken(encodedRefreshToken) {
    const prisma = getPrisma();
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(encodedRefreshToken, 'base64url').toString());
    }
    catch {
        throw new UnauthorizedError('Invalid refresh token');
    }
    const hashed = hashToken(parsed.token);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashed } });
    // Enforce expiry + explicit revocation checks for session invalidation support.
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
        throw new UnauthorizedError('Refresh token expired or revoked');
    }
    // Payload consistency check blocks token tampering across user/portal values.
    if (stored.userId !== parsed.userId || stored.portal !== parsed.portal) {
        throw new UnauthorizedError('Invalid refresh token');
    }
    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) {
        throw new UnauthorizedError('User not found or inactive');
    }
    // Rotate on every refresh to reduce replay window.
    await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    const accessToken = signAccessToken(user.id, user.email, user.role, stored.portal);
    const newRefreshToken = await createRefreshToken(user.id, stored.portal);
    return { accessToken, refreshToken: newRefreshToken };
}
/**
 * Best-effort logout.
 *
 * If token is malformed we still return success to keep logout idempotent
 * from client perspective.
 */
export async function logout(encodedRefreshToken) {
    const prisma = getPrisma();
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(encodedRefreshToken, 'base64url').toString());
    }
    catch {
        // Idempotent logout behavior: invalid token still yields success.
        return; // Invalid token, just ignore
    }
    const hashed = hashToken(parsed.token);
    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashed, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
/**
 * Creates a device change request after validating Google identity.
 * Any existing pending request is auto-closed to keep workflow single-threaded
 * per user.
 */
export async function requestDeviceChangeViaGoogle(googleToken, deviceId, reason) {
    const e = env();
    const google = await verifyGoogleToken(googleToken, e.GOOGLE_WEB_CLIENT_ID);
    const domain = google.email.split('@')[1];
    if (domain !== e.COMPANY_DOMAIN) {
        throw new ForbiddenError('Email domain not allowed');
    }
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
        where: { email: google.email },
        include: { attendanceProfile: true },
    });
    if (!user || !user.isActive) {
        throw new UnauthorizedError('User not found or inactive');
    }
    // Keep only one active pending request per user.
    await prisma.deviceChangeRequest.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'REJECTED', actionAt: new Date(), actionNote: 'Replaced by new request' },
    });
    return prisma.deviceChangeRequest.create({
        data: {
            userId: user.id,
            currentDeviceIdSnapshot: user.attendanceProfile?.boundDeviceId || null,
            requestedDeviceId: deviceId,
            reason,
            status: 'PENDING',
        },
    });
}
//# sourceMappingURL=auth.service.js.map
