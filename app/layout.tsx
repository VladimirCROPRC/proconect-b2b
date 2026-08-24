import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://fiberops-b2b.vladimir-carlan.chatgpt.site"),
  title: "Proconect B2B",
  description:
    "Management și documentare pentru instalări B2B de fibră optică.",
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
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body className="antialiased">{children}</body>
    </html>
  );
}
