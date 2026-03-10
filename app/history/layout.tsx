import AuthGuard from '@/components/layout/AuthGuard'

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
