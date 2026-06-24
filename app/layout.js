import "./globals.css";

export const metadata = {
  title: "Engulfing Alerts",
  description: "Watch price levels for engulfing-candle signals",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans bg-bg text-ink antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
