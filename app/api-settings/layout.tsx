import AuthGuard from '@/components/layout/AuthGuard'

export default function ApiSettingsLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
