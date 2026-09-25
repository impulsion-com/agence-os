import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ToastProvider } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "L'espace de travail open source des agences marketing et media buying : projets, CRM, propositions et reporting.",
};

// Applique thème, accent et densité avant le premier rendu (préférences en localStorage).
const prefsScript = `try{var p=JSON.parse(localStorage.getItem('aos-prefs')||'{}'),d=document.documentElement;if(p.theme&&p.theme!=='system')d.dataset.theme=p.theme;if(p.accent)d.dataset.accent=p.accent;if(p.density)d.dataset.density=p.density}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
