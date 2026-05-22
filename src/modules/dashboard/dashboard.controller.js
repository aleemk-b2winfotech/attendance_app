import { sendSuccess } from '../../common/response.js';
import * as dashboardService from './dashboard.service.js';
// Dashboard endpoints for mobile (self) and web (team/org).
export async function mobileDashboard(req, res) {
    const result = await dashboardService.getMobileDashboard(req.user.sub);
    sendSuccess(res, result);
}
export async function webDashboard(req, res) {
    const { startDate, endDate, isActive } = req.query;
    const result = await dashboardService.getWebDashboard(
        req.user.roles,
        req.user.sub,
        startDate,
        endDate,
        isActive,
    );
    sendSuccess(res, result);
}
//# sourceMappingURL=dashboard.controller.js.map