import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  metadataBase: new URL("https://beamling.ai"),
  title: {
    default: "Beamling — a little light on every answer",
    template: "%s · Beamling",
  },
  description:
    "A bring-your-own-key answer engine. Ask anything, and Beamling shows you exactly where the answer comes from.",
  applicationName: "Beamling",
  openGraph: {
    title: "Beamling — a little light on every answer",
    description: "Your keys. Your models. Clear answers with sources you can inspect.",
    type: "website",
  },
  icons: {
    icon: "/mark.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0C10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
