import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritas Live — verificación en directo",
  description:
    "Verificación de afirmaciones en tiempo real a partir del audio de una pestaña. Transcripción local, evidencia citable y veredictos con nivel de confianza.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
