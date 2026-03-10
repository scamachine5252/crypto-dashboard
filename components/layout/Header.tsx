'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { TrendingUp, LogOut, User, Activity } from 'lucide-react'
import { formatMoney, formatPercent } from '@/lib/utils'

interface HeaderProps {
  totalPnl: number
  annualYield: number
}

export default function Header({ totalPnl, annualYield }: HeaderProps) {
  const { user, logout } = useAuth()
  const router = useRouter()

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const isPositive = totalPnl >= 0

  return (
    <header className="sticky top-0 z-50 bg-[#050b14]/95 backdrop-blur border-b border-[#152035] px-6 py-0 flex items-center justify-between h-16">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div className="hidden sm:block">
          <p className="text-white font-bold text-sm tracking-tight leading-none">NEXUS FUND</p>
          <p className="text-[#4d6b8e] text-[10px] tracking-widest uppercase leading-none mt-0.5">
            PnL Dashboard
          </p>
        </div>
      </div>

      {/* Center — total PnL */}
      <div className="flex items-center gap-6">
        <div className="hidden md:flex items-center gap-2 bg-[#0a1628] border border-[#152035] rounded-lg px-4 py-2">
          <Activity className="w-3.5 h-3.5 text-[#4d6b8e]" />
          <span className="text-[#8ba3c7] text-xs">Total PnL</span>
          <span
            className={`text-sm font-bold ml-1 ${isPositive ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}
          >
            {isPositive ? '+' : ''}
            {formatMoney(totalPnl)}
          </span>
          <span
            className={`text-xs ml-1 ${isPositive ? 'text-[#0ecb81]/70' : 'text-[#f6465d]/70'}`}
          >
            ({formatPercent(annualYield)})
          </span>
        </div>
      </div>

      {/* Right — user */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 text-[#8ba3c7] bg-[#0a1628] border border-[#152035] rounded-lg px-3 py-1.5">
          <User className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{user?.username}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-[#4d6b8e] hover:text-[#f6465d] transition-colors text-xs px-3 py-1.5 rounded-lg hover:bg-[#f6465d]/10 border border-transparent hover:border-[#f6465d]/20"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}
