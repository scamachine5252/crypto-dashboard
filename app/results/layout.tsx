import AuthGuard from '@/components/layout/AuthGuard'

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
