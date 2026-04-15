import '@/app/globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import { ThemeProvider } from 'next-themes';
import { PostHogProvider } from '@/app/providers/posthog-provider';
import { SeoJsonLd } from '@/components/seo-jsonld';
import { TailwindIndicator } from '@/components/tailwind-indicator';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { siteConfig } from '@/config';
import { cn } from '@/lib/utils';

const fontSans = localFont({
  src: '../public/font/font-medium.otf',
  variable: '--font-sans',
  fallback: ['DM Sans', 'system-ui', 'sans-serif'],
});

const fontMono = localFont({
  src: '../public/font/BerkeleyMonoVariable.woff2',
  variable: '--font-mono',
  display: 'swap',
  fallback: [
    'SF Mono',
    'Monaco',
    'Consolas',
    'Ubuntu Mono',
    'Liberation Mono',
    'Courier New',
    'monospace',
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: 'CSM Copilot',
  title: {
    default: 'CSM Copilot',
    template: '%s | CSM Copilot',
  },
  description: siteConfig.description,
  keywords: [
    'customer success',
    'customer success workspace',
    'account intelligence',
    'renewal risk',
    'csm copilot',
    'hubspot',
    'pgvector',
    'account health',
  ],
  authors: [
    {
      name: 'CSM Copilot',
      url: siteConfig.url,
    },
  ],
  creator: 'CSM Copilot',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: 'CSM Copilot',
    description: siteConfig.description,
    siteName: 'CSM Copilot',
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: 'CSM Copilot workspace preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CSM Copilot',
    description: siteConfig.description,
    creator: '@csmcopilot',
    site: '@csmcopilot',
    images: [siteConfig.ogImage],
  },
  icons: {
    icon: '/favicon.ico',
  },
  manifest: '/manifest.webmanifest',
  category: 'Business Software',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            crossOrigin="anonymous"
            src="//unpkg.com/react-grab/dist/index.global.js"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body
        className={cn(fontSans.variable, fontMono.variable, 'antialiased')}
        suppressHydrationWarning
      >
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            disableTransitionOnChange
            enableSystem={false}
            forcedTheme="light"
          >
            <TooltipProvider delayDuration={0}>
              {children}

              <TailwindIndicator />
              <Toaster />
              <SeoJsonLd />
            </TooltipProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
