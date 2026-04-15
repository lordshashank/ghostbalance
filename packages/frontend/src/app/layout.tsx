import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { Web3Provider } from "@/providers/Web3Provider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { ToastProvider } from "@/providers/ToastProvider";
import { ErrorPingWrapper } from "@/providers/ErrorPingProvider";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const siteUrl = "https://ghostbalance.chat";
const tagline = "The only social network where your balance speaks but your identity stays hidden.";

export const metadata: Metadata = {
  title: {
    default: "GhostBalance",
    template: "%s | GhostBalance",
  },
  description: tagline,
  metadataBase: new URL(siteUrl),
  applicationName: "GhostBalance",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "GhostBalance",
    description: tagline,
    url: siteUrl,
    siteName: "GhostBalance",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "GhostBalance",
    description: tagline,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
  keywords: [
    "GhostBalance",
    "anonymous social network",
    "zero knowledge proofs",
    "zk proofs",
    "ethereum",
    "proof of balance",
    "private social",
    "web3 social",
    "Noir circuits",
  ],
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "GhostBalance",
      url: siteUrl,
      description: tagline,
      inLanguage: "en",
    },
    {
      "@type": "Organization",
      name: "GhostBalance",
      url: siteUrl,
      logo: `${siteUrl}/logo.svg`,
    },
  ],
};

// Inline script to prevent FOUC. Sets critical CSS variables from localStorage
// before React hydrates. All values are CSS variables — no data-* boolean flags.
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("ghostbalance-theme");
    if (!t) t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "brutalist" : "warm-coral";
    var m = {
      "matrix":        { bg:"#000000", p:"#10b981", os:"#10b981", sf:"#000000", sc2:"#080808", ov:"#10b981", ol:"rgba(16,185,129,0.2)", gr:"0.015", sc:"0" },
      "cyan-m3":       { bg:"#0e0e13", p:"#8ff5ff", os:"#f9f5fd", sf:"#19191f", sc2:"#1f1f26", ov:"#acaab1", ol:"rgba(6,182,212,0.1)", gr:"0.015", sc:"0" },
      "warm-coral":    { bg:"#FFFBF7", p:"#FF7F50", os:"#2D2A26", sf:"#FFFFFF", sc2:"#F5F0ED", ov:"#8A8078", ol:"#DEDAD4", gr:"0", sc:"0" },
      "synthwave":     { bg:"#0F0A1A", p:"#FF2D7B", os:"#E2E8F0", sf:"#1A0F2E", sc2:"#2D1B4D", ov:"#9B8EC4", ol:"rgba(0,180,216,0.2)", gr:"0", sc:"0.03" },
      "art-deco-noir": { bg:"#080808", p:"#C9A96E", os:"#E8DCC8", sf:"#101010", sc2:"#1A1A1A", ov:"#9A8A6E", ol:"rgba(201,169,110,0.2)", gr:"0.015", sc:"0" },
      "forest-organic":{ bg:"#0D1B0E", p:"#7C9A6E", os:"#E4DCCF", sf:"#1A2E1C", sc2:"#2B1D0E", ov:"#E4DCCF", ol:"rgba(124,154,110,0.3)", gr:"0", sc:"0" },
      "brutalist":     { bg:"#1A1A1A", p:"#FF3B30", os:"#FFFFFF", sf:"#2D2D2D", sc2:"#2D2D2D", ov:"#BBBBBB", ol:"#FFFFFF", gr:"0", sc:"0" },
      "clean-teal":    { bg:"#F8F8F8", p:"#00BCD4", os:"#1A1A1A", sf:"#FFFFFF", sc2:"#F0F0F0", ov:"#666666", ol:"#E5E5E5", gr:"0", sc:"0" }
    };
    var c = m[t] || m["matrix"];
    var h = document.documentElement;
    h.style.setProperty("--color-background", c.bg);
    h.style.setProperty("--color-primary", c.p);
    h.style.setProperty("--color-on-surface", c.os);
    h.style.setProperty("--color-surface", c.sf);
    h.style.setProperty("--color-surface-container", c.sc2);
    h.style.setProperty("--color-on-surface-variant", c.ov);
    h.style.setProperty("--color-outline", c.ol);
    h.style.setProperty("--grain-opacity", c.gr);
    h.style.setProperty("--scanline-opacity", c.sc);
    h.setAttribute("data-theme", t);
    document.body && (document.body.style.backgroundColor = c.bg);
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${spaceGrotesk.variable} font-sans antialiased`}>
        <div className="grain-overlay" />
        <div className="scanline-overlay" />
        <ErrorPingWrapper>
          <ThemeProvider>
            <Web3Provider>
              <AuthProvider>
                <ToastProvider>{children}</ToastProvider>
              </AuthProvider>
            </Web3Provider>
          </ThemeProvider>
        </ErrorPingWrapper>
        <Analytics />
      </body>
    </html>
  );
}
