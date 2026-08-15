import type { Metadata } from 'next';
import { Space_Grotesk, Inter } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://comparatech.cl';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="flex min-h-screen flex-col font-body">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
