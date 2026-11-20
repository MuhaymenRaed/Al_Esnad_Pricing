"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Prominent, debounced search. Press "/" anywhere to focus it. */
export function SearchField({
  value,
  onChange,
  placeholder,
  loading,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  loading?: boolean;
  className?: string;
}) {
  const t = useT();
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  // External changes (chips, "clear all") flow back into the input.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const next = debounced.trim();
    if (next !== lastEmitted.current) {
      lastEmitted.current = next;
      onChange(next);
    }
  }, [debounced, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !target.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={cn(
        "group relative flex h-11 flex-1 items-center rounded-xl border bg-card shadow-card transition-shadow focus-within:border-foreground/25 focus-within:ring-4 focus-within:ring-ring/10",
        className,
      )}
    >
      <Search className="ms-4 size-[18px] shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-[0.95rem] outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden"
      />
      {loading ? <LoaderCircle className="me-3 size-4 animate-spin text-muted-foreground" aria-label={t("filters.searching")} /> : null}
      {text ? (
        <button
          type="button"
          onClick={() => {
            setText("");
            inputRef.current?.focus();
          }}
          className="me-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("filters.clearSearch")}
        >
          <X className="size-4" />
        </button>
      ) : (
        <Kbd className="me-3 hidden sm:inline-flex">/</Kbd>
      )}
    </div>
  );
}
