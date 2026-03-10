import type { Metadata } from 'next'
import { Inter, Space_Grotesk, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import Providers from './providers'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
})

// Kept for monospaced terminal numbers
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Nexus Fund — PnL Dashboard',
  description: 'Professional crypto hedge fund portfolio dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} antialiased`}>
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
