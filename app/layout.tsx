import type { Metadata } from "next";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/inter/cyrillic-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/oswald/cyrillic-500.css";
import "@fontsource/oswald/cyrillic-600.css";
import "@fontsource/oswald/latin-500.css";
import "@fontsource/oswald/latin-600.css";
import "@fontsource/roboto-mono/cyrillic-400.css";
import "@fontsource/roboto-mono/latin-400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Моя неделя — 90-дневный трекер",
  description: "Личный трекер контента, аудитории и проектов на 90 дней.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
