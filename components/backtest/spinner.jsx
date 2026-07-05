import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }) {
  return <Loader2 className={cn("size-6 animate-spin text-primary", className)} aria-hidden="true" />;
}
