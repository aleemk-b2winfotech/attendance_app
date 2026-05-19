import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getPrisma } from '../config/database.js';
import { UnauthorizedError, ForbiddenError } from '../common/errors.js';
import { parseCookies } from '../common/cookies.js';
const WEB_ACCESS_COOKIE = 'attendance_web_access';
export async function authenticate(req, _res, next) {
    const header = req.headers.authorization;
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const cookieToken = parseCookies(req.headers.cookie)[WEB_ACCESS_COOKIE];
    const token = bearerToken || cookieToken;
    if (!token) {
        throw new UnauthorizedError('Missing or invalid session');
    }
    let payload;
    try {
        // Access token contains role + portal context used by downstream authorization guards.
        payload = jwt.verify(token, env().JWT_ACCESS_SECRET);
    }
    catch {
        throw new UnauthorizedError('Invalid or expired access token');
    }
    if (!payload || typeof payload !== 'object' || !payload.sub) {
        throw new UnauthorizedError('Invalid or expired access token');
    }
    const user = await getPrisma().user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true },
    });
    if (!user?.isActive) {
        throw new UnauthorizedError('User not found or inactive');
    }
    req.user = payload;
    next();
}
/** Ensure the token was issued for the given portal */
export function requirePortal(portal) {
    return (req, _res, next) => {
        if (!req.user)
            throw new UnauthorizedError();
        // Prevent cross-portal token reuse (mobile token on web routes, etc.).
        if (req.user.portal !== portal) {
            throw new ForbiddenError(`This endpoint requires ${portal} portal access`);
        }
        next();
    };
}
/** Ensure the user has at least one of the specified roles */
export function requireRoles(...roles) {
    return (req, _res, next) => {
        if (!req.user)
            throw new UnauthorizedError();
        // "any-of" role check; route chooses strictness by what it passes in.
        const hasRole = req.user.roles.some((r) => roles.includes(r));
        if (!hasRole) {
            throw new ForbiddenError('Insufficient role');
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map
