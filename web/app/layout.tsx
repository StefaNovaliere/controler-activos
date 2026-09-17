import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Centinela de precios",
  description: "Qué se vigila y con qué umbrales",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
