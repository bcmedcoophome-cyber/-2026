import type { Metadata } from 'next';
import './globals.css';
import './community.css';
import PwaRegister from './pwa-register';

export const metadata: Metadata = {
  title: '나의 건강관리',
  description: '인지관리, 만성질환 관리, 치매예방 교육과 의료사협 행사 소식을 한곳에서 이용하는 건강관리 앱',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '나의 건강관리',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: '나의 건강관리',
    description: '오늘부터 시작하는 인지·만성질환 건강관리',
    type: 'website',
    images: [{ url: '/og.png', width: 1728, height: 909, alt: '나의 건강관리' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '나의 건강관리',
    description: '오늘부터 시작하는 인지·만성질환 건강관리',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}<PwaRegister /></body></html>;
}
