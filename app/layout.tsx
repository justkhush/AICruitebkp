import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";


const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});


export const metadata: Metadata = {
  title: "AICruite",
  description: "It is an AI mock interview platform that helps job seekers prepare for their interviews by providing them with a realistic interview experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
  className={`${inter.className} antialiased bg-[url('/pattern.png')] bg-repeat`}
>
        {children}
        <Toaster/>
      </body>
    </html>
  );
}
