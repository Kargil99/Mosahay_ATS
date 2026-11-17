import type { Metadata } from "next";
import "./globals.css";
import "./poster.css";
import "./operations.css";
import "./career.css";

export const metadata: Metadata = {
  title: "MoSahay RecruitOS — Recruitment operations",
  description: "Putting people to productive work.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
