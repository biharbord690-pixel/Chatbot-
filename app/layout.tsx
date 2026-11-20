import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-plus-jakarta',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'BGB WhatsApp AI CRM',
  description:
    'Wapio-style WhatsApp AI Chatbot Automation and Live CRM Platform integrated with Bihar Gramin Bazaar.',
  openGraph: {
    title: 'BGB WhatsApp AI CRM',
    description:
      'Wapio-style WhatsApp AI Chatbot Automation and Live CRM Platform integrated with Bihar Gramin Bazaar.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BGB WhatsApp AI CRM',
    description:
      'Wapio-style WhatsApp AI Chatbot Automation and Live CRM Platform integrated with Bihar Gramin Bazaar.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="bg-slate-50 text-slate-900 dark:bg-[#0B1120] dark:text-slate-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-300"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
