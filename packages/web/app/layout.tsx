import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import { appUrl } from "@/lib/server/env";
import "./globals.css";
// Split by surface; the order is the cascade order, keep it.
import "./styles/primitives.css";
import "./styles/form.css";
import "./styles/app-frame.css";
import "./styles/composer.css";
import "./styles/sources.css";
import "./styles/overlays.css";
import "./styles/settings.css";
import "./styles/onboarding.css";
import "./styles/legal.css";
import "./styles/not-found.css";
import "./styles/motion.css";
import "./styles/responsive.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "sans-serif"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(appUrl()),
    title: {
      default: "Beamling — a little light on every answer",
      template: "%s · Beamling",
    },
    description:
      "An answer engine on your own keys. Every claim links to its source.",
    applicationName: "Beamling",
    openGraph: {
      title: "Beamling — a little light on every answer",
      description: "Your keys. Your models. Clear answers with sources you can inspect.",
      type: "website",
      url: "/",
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
      apple: "/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0C0C0D",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request so Next.js can put the CSP nonce from proxy.ts on its scripts.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
