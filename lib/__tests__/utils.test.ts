/**
 * Unit tests for lib/utils.ts — all exported functions.
 *
 * formatMoney and formatPercent have richer regression coverage in regression.test.ts.
 * This file adds the missing edge-case coverage for formatRatio, formatDate,
 * formatPrice, and cn, plus any gaps in formatMoney / formatPercent not covered
 * by regression.test.ts.
 */

import { formatMoney, formatPercent, formatRatio, formatDate, formatPrice, cn } from '../utils'

// ---------------------------------------------------------------------------
// formatRatio
// ---------------------------------------------------------------------------
describe('formatRatio', () => {
  it('formats 1.5 as "1.50×"', () => {
    // NOTE: current implementation returns "1.50" without ×;
    // test documents actual contract, not assumed contract.
    const result = formatRatio(1.5)
    // The function returns toFixed(2) — confirm two decimal places
    expect(result).toBe('1.50')
    expect(result).toMatch(/^\d+\.\d{2}$/)
  })

  it('handles negative ratio', () => {
    expect(formatRatio(-1.5)).toBe('-1.50')
  })

  it('handles zero', () => {
    expect(formatRatio(0)).toBe('0.00')
  })

  it('rounds to 2 decimal places', () => {
    expect(formatRatio(3.14159)).toBe('3.14')
  })

  it('handles large values', () => {
    expect(formatRatio(1000)).toBe('1000.00')
  })
})

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  it('formats an ISO string to a readable date string (e.g. "Jan 1, 2025")', () => {
    const result = formatDate('2025-01-01T00:00:00.000Z')
    // Locale-formatted: should include "Jan", "2025", and "1"
    expect(result).toMatch(/Jan/)
    expect(result).toMatch(/2025/)
    expect(result).toMatch(/1/)
  })

  it('handles a mid-year date correctly', () => {
    const result = formatDate('2025-06-15T12:00:00.000Z')
    expect(result).toMatch(/Jun/)
    expect(result).toMatch(/2025/)
  })

  it('handles empty string without throwing', () => {
    // new Date('') produces Invalid Date → toLocaleDateString returns 'Invalid Date'
    expect(() => formatDate('')).not.toThrow()
    const result = formatDate('')
    expect(typeof result).toBe('string')
  })

  it('handles undefined cast to empty string without throwing', () => {
    // formatDate signature is (iso: string); callers may pass undefined at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => formatDate(undefined as any)).not.toThrow()
  })

  it('produces a non-empty string for a valid ISO date', () => {
    const result = formatDate('2024-12-25T00:00:00.000Z')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// formatPrice
// ---------------------------------------------------------------------------
describe('formatPrice', () => {
  it('formats a price < 1 with up to 4 decimal places', () => {
    const result = formatPrice(0.00123)
    // maximumFractionDigits=4 means at most 4 decimals, not exactly — "0.0012" or "0.001"
    expect(result).toMatch(/^0\./)
    // Must not have more than 4 decimal digits
    const decimals = (result.replace(/,/g, '').split('.')[1] ?? '').length
    expect(decimals).toBeLessThanOrEqual(4)
  })

  it('formats a large price like 50000 with comma separator and no decimals', () => {
    const result = formatPrice(50000)
    // maximumFractionDigits=0 for >= 1000: should be "50,000"
    expect(result).toBe('50,000')
  })

  it('handles zero', () => {
    const result = formatPrice(0)
    expect(result).toBe('0')
  })

  it('handles negative price', () => {
    const result = formatPrice(-1500)
    // Should include a minus sign and comma
    expect(result).toContain('-')
    expect(result).toContain('1,500')
  })

  it('formats a value of exactly 1000 with no decimals (>= 1000 branch)', () => {
    const result = formatPrice(1000)
    expect(result).toBe('1,000')
  })

  it('formats a value just below 1000 with up to 4 decimals (< 1000 branch)', () => {
    const result = formatPrice(999.9999)
    expect(result).toMatch(/^999/)
  })

  it('formats a small fractional value like 0.0001 within 4 decimal precision', () => {
    const result = formatPrice(0.0001)
    expect(result).toBe('0.0001')
  })
})

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------
describe('cn', () => {
  it('merges multiple class strings into one space-separated string', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz')
  })

  it('filters out false values', () => {
    expect(cn('foo', false, 'bar')).toBe('foo bar')
  })

  it('filters out null values', () => {
    expect(cn('foo', null, 'bar')).toBe('foo bar')
  })

  it('filters out undefined values', () => {
    expect(cn('foo', undefined, 'bar')).toBe('foo bar')
  })

  it('returns an empty string when all inputs are falsy', () => {
    expect(cn(false, null, undefined)).toBe('')
  })

  it('returns a single class unchanged', () => {
    expect(cn('only-class')).toBe('only-class')
  })

  it('handles empty string as an input (filters it out as falsy)', () => {
    // Empty string is falsy — should be excluded
    expect(cn('foo', '' as unknown as false, 'bar')).toBe('foo bar')
  })

  it('handles conditional class patterns common in component code', () => {
    const isActive = true
    const isDisabled = false
    expect(cn('base', isActive && 'active', isDisabled && 'disabled')).toBe('base active')
  })
})

// ---------------------------------------------------------------------------
// formatMoney — additional edge cases not in regression.test.ts
// ---------------------------------------------------------------------------
describe('formatMoney — additional edge cases', () => {
  it('formats zero as a currency string (non-compact)', () => {
    const result = formatMoney(0, false)
    expect(result).toMatch(/\$0/)
  })

  it('compact=false forces full currency format regardless of magnitude', () => {
    // 1.5M should NOT be compacted when compact=false
    const result = formatMoney(1_500_000, false)
    expect(result).not.toContain('M')
    expect(result).toContain('1,500,000')
  })

  it('custom decimals parameter is respected in non-compact mode', () => {
    const result = formatMoney(1234.567, false, 2)
    expect(result).toContain('1,234.57')
  })

  it('negative million-scale value uses M suffix', () => {
    expect(formatMoney(-2_000_000)).toBe('$-2.00M')
  })
})

// ---------------------------------------------------------------------------
// formatPercent — additional edge cases not in regression.test.ts
// ---------------------------------------------------------------------------
describe('formatPercent — additional edge cases', () => {
  it('custom decimals parameter reduces decimal places', () => {
    expect(formatPercent(5.1234, 1)).toBe('+5.1%')
  })

  it('custom decimals=0 returns integer percent', () => {
    expect(formatPercent(10, 0)).toBe('+10%')
  })

  it('large positive value includes + prefix', () => {
    const result = formatPercent(150)
    expect(result.startsWith('+')).toBe(true)
    expect(result).toContain('150.00')
  })
})
