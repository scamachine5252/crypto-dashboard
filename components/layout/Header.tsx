'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { useRouter, usePathname } from 'next/navigation'
import { NAV_ITEMS } from '@/lib/nav'
import { TrendingUp, LogOut, User, ChevronDown, Sun, Moon, RefreshCw } from 'lucide-react'
import NavDropdown from './NavDropdown'

interface AccountMeta {
  id: string
  exchange: string
  last_full_sync_at: string | null
}

export default function Header() {
  const { user, logout } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const currentPage = NAV_ITEMS.find((n) => pathname.startsWith(n.href))

  const [navOpen, setNavOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openNav = useCallback(() => {
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

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountMeta[]>([])

  // Load account metadata once on mount — used to detect Binance accounts without full scan
  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AccountMeta[]) => setAccounts(data))
      .catch(() => { /* non-critical — notice simply won't show */ })
  }, [])

  const handleSync = useCallback(async () => {
    // Block sync if any Binance account hasn't had its first full scan
    const needsFullScan = accounts.some(
      (a) => a.exchange === 'binance' && a.last_full_sync_at === null
    )
    if (needsFullScan) {
      setSyncMsg('Load full history in API Settings first')
      setTimeout(() => setSyncMsg(null), 4000)
      return
    }

    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const json = await res.json()
      setSyncMsg(res.ok ? `Synced ${json.synced} accounts` : 'Sync failed')
    } catch {
      setSyncMsg('Sync failed')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 3000)
    }
  }, [accounts])

  return (
    <header
      className="sticky top-0 z-50 px-6 flex items-center justify-between h-14"
      style={{
        background: theme === 'light' ? 'rgba(240,242,245,0.95)' : 'rgba(10,10,10,0.95)',
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
          className="w-7 h-7 rounded flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-blue)' }}
        >
          <TrendingUp className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="hidden sm:block">
          <p
            className="font-bold text-sm tracking-tight leading-none font-heading"
            style={{ color: 'var(--text-primary)' }}
          >
            CICADA FOUNDATION
          </p>
          <p
            className="text-[10px] tracking-widest uppercase leading-none mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {currentPage?.label ?? 'PnL Dashboard'}
          </p>
        </div>
        <ChevronDown
          className="w-3 h-3 hidden sm:block"
          style={{
            color: 'var(--text-muted)',
            transform: navOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
        {navOpen && <NavDropdown />}
      </div>

      {/* Right — theme toggle + user + logout */}
      <div className="flex items-center gap-2">
        {/* Sync Now */}
        <div className="relative flex items-center">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: syncMsg === 'Sync failed' ? 'var(--accent-loss)' : syncMsg ? 'var(--accent-profit)' : 'var(--border-subtle)',
              color: syncMsg === 'Sync failed' ? 'var(--accent-loss)' : syncMsg ? 'var(--accent-profit)' : 'var(--text-muted)',
              opacity: syncing ? 0.7 : 1,
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
            title="Sync exchange data now"
          >
            <RefreshCw
              className="w-3 h-3"
              style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}
            />
            <span className="hidden sm:inline font-mono tracking-widest uppercase text-[10px]">
              {syncMsg ?? 'Sync Now'}
            </span>
          </button>
        </div>

        {/* User pill */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <User className="w-3 h-3" />
          <span className="text-xs font-medium">{user?.username}</span>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-7 h-7 border"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onMouseEnter={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--accent-gold)'
            el.style.borderColor = 'var(--accent-gold)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--text-muted)'
            el.style.borderColor = 'var(--border-subtle)'
          }}
        >
          {theme === 'dark'
            ? <Sun className="w-3.5 h-3.5" />
            : <Moon className="w-3.5 h-3.5" />
          }
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-transparent"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--accent-loss)'
            el.style.background = 'rgba(255,59,59,0.07)'
            el.style.borderColor = 'rgba(255,59,59,0.18)'
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
