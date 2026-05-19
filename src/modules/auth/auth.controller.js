import { sendSuccess } from '../../common/response.js';
import { BadRequestError, UnauthorizedError } from '../../common/errors.js';
import { parseCookies } from '../../common/cookies.js';
import * as authService from './auth.service.js';
const WEB_ACCESS_COOKIE = 'attendance_web_access';
const WEB_REFRESH_COOKIE = 'attendance_web_refresh';
const WEB_OAUTH_STATE_COOKIE = 'attendance_web_oauth_state';
const WEB_OAUTH_VERIFIER_COOKIE = 'attendance_web_oauth_verifier';
function parseDurationMs(dur) {
    const match = dur.match(/^(\d+)([smhd])$/);
    if (!match)
        return 15 * 60 * 1000;
    const val = parseInt(match[1], 10);
    switch (match[2]) {
        case 's': return val * 1000;
        case 'm': return val * 60 * 1000;
        case 'h': return val * 60 * 60 * 1000;
        case 'd': return val * 24 * 60 * 60 * 1000;
        default: return 15 * 60 * 1000;
    }
}
function isWebRequest(req) {
    return req.originalUrl.startsWith('/api/v1/web/');
}
function cookieOptions(req, { maxAge, sameSite } = {}) {
    const secure = req.app.get('env') === 'production';
    return {
        httpOnly: true,
        secure,
        sameSite: sameSite || (secure ? 'none' : 'lax'),
        path: '/api/v1/web',
        ...(maxAge ? { maxAge } : {}),
    };
}
function setWebSessionCookies(req, res, result) {
    res.cookie(WEB_ACCESS_COOKIE, result.accessToken, cookieOptions(req, {
        maxAge: parseDurationMs(authService.getAuthConfig().accessTtl),
    }));
    res.cookie(WEB_REFRESH_COOKIE, result.refreshToken, cookieOptions(req, {
        maxAge: parseDurationMs(authService.getAuthConfig().refreshTtl),
    }));
}
function clearWebSessionCookies(req, res) {
    res.clearCookie(WEB_ACCESS_COOKIE, cookieOptions(req));
    res.clearCookie(WEB_REFRESH_COOKIE, cookieOptions(req));
}
function clearWebOAuthCookies(req, res) {
    res.clearCookie(WEB_OAUTH_STATE_COOKIE, cookieOptions(req, { sameSite: 'lax' }));
    res.clearCookie(WEB_OAUTH_VERIFIER_COOKIE, cookieOptions(req, { sameSite: 'lax' }));
}
function webSessionPayload(req) {
    return {
        user: {
            id: req.user.sub,
            email: req.user.email,
            roles: req.user.roles,
            portal: req.user.portal,
        },
    };
}
function getWebCallbackUrl(req) {
    const configured = authService.getAuthConfig().webCallbackUrl;
    if (configured)
        return configured;
    return `${req.protocol}://${req.get('host')}/api/v1/web/auth/google/callback`;
}
function getWebRedirectUrl(_req, type) {
    const config = authService.getAuthConfig();
    if (type === 'success')
        return config.webSuccessUrl || `${config.webOrigin}/dashboard`;
    return config.webFailureUrl || `${config.webOrigin}/login?error=google_auth_failed`;
}
// Controller layer is intentionally thin: parse request -> service -> standardized response.
export async function mobileGoogleLogin(req, res) {
    const { googleToken, deviceId, portal } = req.body;
    const result = portal === 'admin'
        ? await authService.loginWeb(googleToken)
        : await authService.loginMobile(googleToken, deviceId);
    sendSuccess(res, result, undefined, 'Login successful');
}
export async function webGoogleStart(req, res) {
    const state = authService.createOAuthState();
    const pkce = authService.createPkcePair();
    const redirectUri = getWebCallbackUrl(req);
    res.cookie(WEB_OAUTH_STATE_COOKIE, state, cookieOptions(req, {
        maxAge: 10 * 60 * 1000,
        sameSite: 'lax',
    }));
    res.cookie(WEB_OAUTH_VERIFIER_COOKIE, pkce.verifier, cookieOptions(req, {
        maxAge: 10 * 60 * 1000,
        sameSite: 'lax',
    }));
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', authService.getAuthConfig().googleWebClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('hd', authService.getAuthConfig().companyDomain);
    url.searchParams.set('prompt', 'select_account');
    res.redirect(url.toString());
}
export async function webGoogleCallback(req, res) {
    const { code, state, error } = req.query;
    const failureUrl = getWebRedirectUrl(req, 'failure');
    if (error) {
        clearWebOAuthCookies(req, res);
        res.redirect(`${failureUrl}${failureUrl.includes('?') ? '&' : '?'}reason=${encodeURIComponent(error)}`);
        return;
    }
    if (typeof code !== 'string' || typeof state !== 'string') {
        throw new BadRequestError('Missing Google authorization response');
    }
    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies[WEB_OAUTH_STATE_COOKIE];
    const verifier = cookies[WEB_OAUTH_VERIFIER_COOKIE];
    clearWebOAuthCookies(req, res);
    if (!expectedState || expectedState !== state || !verifier) {
        throw new UnauthorizedError('Invalid Google authorization state');
    }
    const result = await authService.loginWebWithAuthorizationCode(code, verifier, getWebCallbackUrl(req));
    setWebSessionCookies(req, res, result);
    res.redirect(getWebRedirectUrl(req, 'success'));
}
export async function webSession(req, res) {
    sendSuccess(res, webSessionPayload(req));
}
export async function refreshToken(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = req.body?.refreshToken || cookies[WEB_REFRESH_COOKIE];
    if (!refreshToken) {
        throw new UnauthorizedError('Missing refresh token');
    }
    // Variable name mirrors API contract, even though it shadows function name.
    const result = await authService.refreshAccessToken(refreshToken);
    if (isWebRequest(req)) {
        setWebSessionCookies(req, res, result);
        sendSuccess(res, null);
        return;
    }
    sendSuccess(res, result);
}
export async function logoutHandler(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = req.body?.refreshToken || cookies[WEB_REFRESH_COOKIE];
    if (refreshToken) {
        await authService.logout(refreshToken);
    }
    if (isWebRequest(req)) {
        clearWebSessionCookies(req, res);
    }
    sendSuccess(res, null, undefined, 'Logged out');
}
export async function requestDeviceChange(req, res) {
    const { googleToken, deviceId, reason } = req.body;
    const result = await authService.requestDeviceChangeViaGoogle(googleToken, deviceId, reason);
    sendSuccess(res, result, undefined, 'Device change request submitted');
}
//# sourceMappingURL=auth.controller.js.map
