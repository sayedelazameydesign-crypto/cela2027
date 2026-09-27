import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cela 2027 — وكيلك الذكي المستقل",
  description:
    "وكيل ذكاء اصطناعي مستقل: يخطط، ينفّذ، يتحقق بالأدلة — وكيل برمجي كامل وصندوق Python معزول بأسلوب مانوس.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-ink-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
