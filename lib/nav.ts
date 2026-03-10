export interface NavItem {
  label: string
  href: string
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',    href: '/dashboard',    description: 'Portfolio overview & metrics' },
  { label: 'Performance',  href: '/performance',  description: 'Metrics deep-dive & comparisons' },
  { label: 'Results',      href: '/results',      description: 'Equity curves & comparison table' },
  { label: 'History',      href: '/history',      description: 'Full trade log & export' },
  { label: 'API',          href: '/api-settings', description: 'Connect exchanges & manage keys' },
]
