"use strict";
/**
 * Tests for new FREE/SUPPORTER plan structure
 */
Object.defineProperty(exports, "__esModule", { value: true });
const planLimits_1 = require("../../utils/planLimits");
describe('Plan Limits - New Business Model', () => {
    describe('FREE Plan', () => {
        it('should have correct starting credits', () => {
            const limits = (0, planLimits_1.getPlanLimits)('FREE');
            expect(limits.startingCredits).toBe(100);
        });
        it('should have correct monthly refill amount', () => {
            const limits = (0, planLimits_1.getPlanLimits)('FREE');
            expect(limits.creditRefillAmount).toBe(50);
        });
        it('should have correct rate limits', () => {
            const limits = (0, planLimits_1.getPlanLimits)('FREE');
            expect(limits.rateLimits.perHour).toBe(20);
            expect(limits.rateLimits.perMinute).toBe(5);
            expect(limits.rateLimits.perDay).toBe(100);
        });
        it('should enable API access', () => {
            const limits = (0, planLimits_1.getPlanLimits)('FREE');
            expect(limits.apiAccess).toBe(true);
        });
        it('should allow 1 API key', () => {
            const limits = (0, planLimits_1.getPlanLimits)('FREE');
            expect(limits.maxApiKeys).toBe(1);
        });
        it('should be free ($0)', () => {
            expect(planLimits_1.PLAN_PRICES.FREE).toBe(0);
        });
    });
    describe('SUPPORTER Plan', () => {
        it('should have correct starting credits', () => {
            const limits = (0, planLimits_1.getPlanLimits)('SUPPORTER');
            expect(limits.startingCredits).toBe(1000);
        });
        it('should have correct monthly refill amount', () => {
            const limits = (0, planLimits_1.getPlanLimits)('SUPPORTER');
            expect(limits.creditRefillAmount).toBe(500);
        });
        it('should have correct rate limits', () => {
            const limits = (0, planLimits_1.getPlanLimits)('SUPPORTER');
            expect(limits.rateLimits.perHour).toBe(60);
            expect(limits.rateLimits.perMinute).toBe(15);
            expect(limits.rateLimits.perDay).toBe(500);
        });
        it('should enable API access', () => {
            const limits = (0, planLimits_1.getPlanLimits)('SUPPORTER');
            expect(limits.apiAccess).toBe(true);
        });
        it('should allow 5 API keys', () => {
            const limits = (0, planLimits_1.getPlanLimits)('SUPPORTER');
            expect(limits.maxApiKeys).toBe(5);
        });
        it('should cost $5/month', () => {
            expect(planLimits_1.PLAN_PRICES.SUPPORTER).toBe(5);
        });
    });
    describe('Business Model Validation', () => {
        it('should have only 2 active plans', () => {
            const activePlans = Object.keys(planLimits_1.PLAN_LIMITS);
            expect(activePlans).toHaveLength(2);
            expect(activePlans).toContain('FREE');
            expect(activePlans).toContain('SUPPORTER');
        });
        it('FREE should have lower limits than SUPPORTER', () => {
            const freeLimits = (0, planLimits_1.getPlanLimits)('FREE');
            const supporterLimits = (0, planLimits_1.getPlanLimits)('SUPPORTER');
            expect(freeLimits.startingCredits).toBeLessThan(supporterLimits.startingCredits);
            expect(freeLimits.creditRefillAmount).toBeLessThan(supporterLimits.creditRefillAmount);
            expect(freeLimits.rateLimits.perHour).toBeLessThan(supporterLimits.rateLimits.perHour);
            expect(freeLimits.maxApiKeys).toBeLessThan(supporterLimits.maxApiKeys);
        });
        it('should be cost-recovery focused (low price)', () => {
            expect(planLimits_1.PLAN_PRICES.SUPPORTER).toBe(5); // $5/mo cost recovery
            expect(planLimits_1.PLAN_PRICES.SUPPORTER).toBeLessThan(10); // Not profit-focused
        });
    });
});
