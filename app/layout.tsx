import type { Metadata } from "next";
import { Bodoni_Moda, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"]
});

const body = Barlow_Condensed({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "600", "700"]
});

const meta = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-meta",
  weight: ["400", "500"]
});

export const metadata: Metadata = {
  title: "Movie Buff Archive",
  description:
    "A cinematic historical archive of major film festivals and awards across decades.",
  metadataBase: new URL("https://example.com")
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${meta.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
