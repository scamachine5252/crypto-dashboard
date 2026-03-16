import type { Metadata } from 'next'
import { Rajdhani, DM_Sans } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import Providers from './providers'

const rajdhani = Rajdhani({
  variable: '--font-rajdhani',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Cicada Foundation — PnL Dashboard',
  description: 'Professional crypto hedge fund portfolio dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${rajdhani.variable} ${dmSans.variable} antialiased`}>
        {/* Anti-flash: runs before hydration, prevents light/dark flicker */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
