import type { RevenueEvent } from '../owner-analytics.js';

export const reconciliationAsOf = '2026-01-15T12:00:00.000Z';
export function reconciliationEvents(): RevenueEvent[] {
  const row = (eventId: string, kind: RevenueEvent['kind'], grossMinor: number, netMinor: number, currency: string): RevenueEvent => ({
    eventId, kind, grossMinor, netMinor, currency,
    occurredAt: new Date('2026-01-14T10:00:00.000Z'), description: 'Synthetic reconciliation fixture',
  });
  return [
    row('fixture-usd-charge', 'charge', 10000, 9700, 'USD'),
    row('fixture-usd-refund', 'refund', -2000, -2000, 'USD'),
    row('fixture-eur-charge', 'charge', 5000, 4800, 'EUR'),
  ];
}
export const expectedBalanceActivity = {
  USD: { grossMinor: 10000, refundMinor: -2000, netMinor: 7700, eventCount: 2 },
  EUR: { grossMinor: 5000, refundMinor: 0, netMinor: 4800, eventCount: 1 },
};
// These are signed balance-activity expectations, not recognized revenue or profit.
// Embedded charge fees are 300 USD minor units and 200 EUR minor units.
// The existing cache has no explicit fee column; fee reconciliation remains a separate blocker.
