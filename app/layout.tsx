import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegistration } from "./pwa-registration";

export const metadata: Metadata = {
  metadataBase: new URL("https://proconect-b2b.vladimir-carlan.workers.dev"),
  title: "Proconect B2B",
  description:
    "Management și documentare pentru instalări B2B de fibră optică.",
  applicationName: "Proconect B2B",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Proconect B2B",
    description:
      "Management și documentare pentru instalări B2B de fibră optică.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Proconect B2B — Instalări de fibră. Documentate complet.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Proconect B2B",
    description:
      "Management și documentare pentru instalări B2B de fibră optică.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/pwa-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/pwa-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#465894",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body className="antialiased">
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
