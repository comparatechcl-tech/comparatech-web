import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SITE_URL } from '@/lib/site';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ComparaTech — Compara precios de tecnología en Chile',
    template: '%s | ComparaTech',
  },
  description:
    'Compara precios de celulares, notebooks, electrónica y hogar en Chile antes de comprar en Mercado Libre.',
  openGraph: {
    type: 'website',
    locale: 'es_CL',
    siteName: 'ComparaTech',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', images: ['/og-image.png'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" className={inter.variable} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-body">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 -z-10 opacity-40 transition-opacity duration-200 dark:opacity-100"
            style={{
              background:
                'radial-gradient(38% 32% at 12% 0%, rgba(8,126,255,0.16) 0%, rgba(8,126,255,0) 60%), ' +
                'radial-gradient(30% 28% at 92% 18%, rgba(0,212,255,0.12) 0%, rgba(0,212,255,0) 60%), ' +
                'radial-gradient(35% 30% at 15% 92%, rgba(8,126,255,0.10) 0%, rgba(8,126,255,0) 60%), ' +
                'radial-gradient(32% 30% at 100% 85%, rgba(0,212,255,0.10) 0%, rgba(0,212,255,0) 60%)',
            }}
          />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
