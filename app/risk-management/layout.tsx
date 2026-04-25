import AuthGuard from '@/components/layout/AuthGuard'

export default function RiskManagementLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
