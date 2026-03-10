'use client'

import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from '@/lib/theme-context'
import type { ReactNode } from 'react'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  )
}
