"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Slice a list into pages.
 *
 * The page resets to 1 whenever the list identity changes — otherwise a filter
 * that shrinks the list leaves you stranded on a page that no longer exists.
 */
export function usePagination(items, initialSize = 50) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);

  const total = items?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / size));

  useEffect(() => {
    setPage(1);
  }, [items, size]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * size;
  const end = Math.min(start + size, total);

  const pageItems = useMemo(
    () => (items ? items.slice(start, start + size) : []),
    [items, start, size]
  );

  return {
    page: safePage,
    pageCount,
    size,
    total,
    from: total === 0 ? 0 : start + 1,
    to: end,
    pageItems,
    setPage,
    setSize,
  };
}

/** Page controls — render directly under the table they belong to. */
export function Pagination({ pagination, label = "rows", className = "" }) {
  const { page, pageCount, size, total, from, to, setPage, setSize } = pagination;
  if (total === 0) return null;

  const first = page <= 1;
  const last = page >= pageCount;

  return (
    <div
      className={`flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tnum">
          {from}–{to} of {total} {label}
        </span>
        <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
          <SelectTrigger className="h-8 w-[108px] shrink-0 text-xs" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline" size="icon" className="size-8"
          onClick={() => setPage(1)} disabled={first} aria-label="First page"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline" size="icon" className="size-8"
          onClick={() => setPage(page - 1)} disabled={first} aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2 text-xs tabular-nums text-muted-foreground">
          Page {page} / {pageCount}
        </span>
        <Button
          variant="outline" size="icon" className="size-8"
          onClick={() => setPage(page + 1)} disabled={last} aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline" size="icon" className="size-8"
          onClick={() => setPage(pageCount)} disabled={last} aria-label="Last page"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
