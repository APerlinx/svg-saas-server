"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const planLimits_1 = require("../utils/planLimits");
const router = (0, express_1.Router)();
const PLAN_TYPES = Object.keys(planLimits_1.PLAN_LIMITS);
const PLAN_FEATURES = Object.keys(planLimits_1.PLAN_LIMITS.FREE);
function isPlanType(value) {
    return typeof value === 'string' && PLAN_TYPES.includes(value);
}
function parsePlanParam(value) {
    if (!isPlanType(value))
        return null;
    return value;
}
function parseNonNegativeInt(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0)
        return null;
    return Math.floor(parsed);
}
function parseOptionalNonNegativeInt(value) {
    if (value === undefined)
        return undefined;
    return parseNonNegativeInt(value);
}
router.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    const plans = PLAN_TYPES.reduce((acc, plan) => {
        acc[plan] = {
            plan,
            name: planLimits_1.PLAN_NAMES[plan],
            description: planLimits_1.PLAN_DESCRIPTIONS[plan],
            price: planLimits_1.PLAN_PRICES[plan],
            limits: planLimits_1.PLAN_LIMITS[plan],
        };
        return acc;
    }, {});
    res.json({ plans });
});
router.get('/limits/:plan', (req, res) => {
    const plan = parsePlanParam(req.params.plan);
    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan' });
    }
    return res.json({ plan, limits: (0, planLimits_1.getPlanLimits)(plan) });
});
router.get('/has-feature', (req, res) => {
    const plan = parsePlanParam(req.query.plan);
    const feature = req.query.feature;
    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan' });
    }
    if (typeof feature !== 'string' || !PLAN_FEATURES.includes(feature)) {
        return res.status(400).json({ error: 'Invalid feature' });
    }
    return res.json({
        plan,
        feature,
        hasFeature: (0, planLimits_1.hasFeature)(plan, feature),
    });
});
router.get('/can-create-api-key', (req, res) => {
    const plan = parsePlanParam(req.query.plan);
    const currentKeyCount = parseNonNegativeInt(req.query.currentKeyCount);
    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan' });
    }
    if (currentKeyCount === null) {
        return res.status(400).json({ error: 'Invalid currentKeyCount' });
    }
    return res.json({
        plan,
        currentKeyCount,
        canCreateApiKey: (0, planLimits_1.canCreateApiKey)(plan, currentKeyCount),
    });
});
router.post('/recommendation', (req, res) => {
    var _a, _b, _c, _d, _e;
    const currentPlan = parsePlanParam((_a = req.body) === null || _a === void 0 ? void 0 : _a.currentPlan);
    if (!currentPlan) {
        return res.status(400).json({ error: 'Invalid currentPlan' });
    }
    const creditsUsedRaw = (_c = (_b = req.body) === null || _b === void 0 ? void 0 : _b.usage) === null || _c === void 0 ? void 0 : _c.creditsUsed;
    const generationsUsedRaw = (_e = (_d = req.body) === null || _d === void 0 ? void 0 : _d.usage) === null || _e === void 0 ? void 0 : _e.generationsUsed;
    const creditsUsed = parseOptionalNonNegativeInt(creditsUsedRaw);
    const generationsUsed = parseOptionalNonNegativeInt(generationsUsedRaw);
    if (creditsUsed === null) {
        return res.status(400).json({ error: 'Invalid creditsUsed' });
    }
    if (generationsUsed === null) {
        return res.status(400).json({ error: 'Invalid generationsUsed' });
    }
    const recommendation = (0, planLimits_1.getUpgradeRecommendation)(currentPlan, {
        creditsUsed,
        generationsUsed,
    });
    return res.json({
        currentPlan,
        usage: {
            creditsUsed,
            generationsUsed,
        },
        ...recommendation,
    });
});
exports.default = router;
