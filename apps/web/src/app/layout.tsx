import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Executive Agent",
  description: "AI Executive Agent Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}