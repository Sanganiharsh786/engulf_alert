import "./globals.css";
import { ToastProvider } from "./toast";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata = {
  title: "Engulfing Alerts",
  description: "Watch price levels for engulfing-candle signals",
};

export const viewport = {
  themeColor: "#0a0e1a",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark bg-background">
      <body className="font-sans bg-background text-foreground antialiased min-h-screen">
        <ToastProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
