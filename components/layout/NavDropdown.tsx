'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from '@/lib/nav'

export default function NavDropdown() {
  const pathname = usePathname()

  return (
    <div
      className="absolute top-full left-0 mt-2 w-56 py-1.5 rounded-xl border z-50 animate-slide-down"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-medium)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col gap-0.5 px-3.5 py-2.5 mx-1 rounded-lg transition-colors"
            style={{
              background: isActive ? 'rgba(255,215,0,0.07)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <span
              className="text-xs font-semibold tracking-wide font-heading"
              style={{ color: isActive ? 'var(--accent-gold)' : 'var(--text-primary)' }}
            >
              {item.label}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {item.description}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
