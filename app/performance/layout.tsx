import AuthGuard from '@/components/layout/AuthGuard'

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
