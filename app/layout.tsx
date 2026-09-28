import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter, Tiro_Devanagari_Sanskrit } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
});
const sans = Inter({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500"] });
const sanskrit = Tiro_Devanagari_Sanskrit({
  variable: "--font-sanskrit",
  subsets: ["devanagari", "latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Talk to Krishna",
  description: "A spoken conversation with Krishna, grounded in the Bhagavad Gita and the stories of his life.",
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${sanskrit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
