import type { Metadata, Viewport } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Read to Me — hear what’s on your screen",
  description:
    "Accessibility reading app: point your device at text and hear it spoken aloud in a natural voice.",
  applicationName: "Read to Me",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Read to Me",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f4c4a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
