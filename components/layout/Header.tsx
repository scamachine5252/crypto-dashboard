'use client'

import { useState, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { TrendingUp, LogOut, User, Activity, ChevronDown } from 'lucide-react'
import { formatMoney, formatPercent } from '@/lib/utils'
import NavDropdown from './NavDropdown'

interface HeaderProps {
  totalPnl: number
  annualYield: number
}

export default function Header({ totalPnl, annualYield }: HeaderProps) {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [navOpen, setNavOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openNav  = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setNavOpen(true)
  }, [])

  const closeNav = useCallback(() => {
    closeTimer.current = setTimeout(() => setNavOpen(false), 300)
  }, [])

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const isPositive = totalPnl >= 0

  return (
    <header
      className="sticky top-0 z-50 px-6 flex items-center justify-between h-16"
      style={{
        background: 'rgba(10,10,15,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Logo + nav trigger */}
      <div
        ref={navRef}
        className="relative flex items-center gap-3 cursor-pointer select-none"
        onMouseEnter={openNav}
        onMouseLeave={closeNav}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-blue)' }}
        >
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div className="hidden sm:block">
          <p
            className="font-bold text-sm tracking-tight leading-none font-heading"
            style={{ color: 'var(--text-primary)' }}
          >
            NEXUS FUND
          </p>
          <p className="text-[10px] tracking-widest uppercase leading-none mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            PnL Dashboard
          </p>
        </div>
        <ChevronDown
          className="w-3 h-3 hidden sm:block transition-transform duration-150"
          style={{
            color: 'var(--text-muted)',
            transform: navOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
        {navOpen && <NavDropdown />}
      </div>

      {/* Center — total PnL */}
      <div className="flex items-center gap-6">
        <div
          className="hidden md:flex items-center gap-2 rounded-lg px-4 py-2"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Activity className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total PnL</span>
          <span
            className="text-sm font-bold ml-1 tabular"
            style={{ color: isPositive ? 'var(--accent-profit)' : 'var(--accent-loss)' }}
          >
            {isPositive ? '+' : ''}{formatMoney(totalPnl)}
          </span>
          <span
            className="text-xs ml-1 tabular"
            style={{ color: isPositive ? 'color-mix(in srgb, var(--accent-profit) 60%, transparent)' : 'color-mix(in srgb, var(--accent-loss) 60%, transparent)' }}
          >
            ({formatPercent(annualYield)})
          </span>
        </div>
      </div>

      {/* Right — user */}
      <div className="flex items-center gap-3">
        <div
          className="hidden sm:flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <User className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{user?.username}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-transparent transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--accent-loss)'
            el.style.background = 'rgba(255,59,59,0.08)'
            el.style.borderColor = 'rgba(255,59,59,0.2)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--text-muted)'
            el.style.background = 'transparent'
            el.style.borderColor = 'transparent'
          }}
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}
