import Link from "next/link";

/** Lives apart from SiteHeader so client components can use it without
 *  pulling server-only auth code into the browser bundle. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`group flex items-center gap-2 ${className}`} aria-label="GameSmith home">
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-amber">
        <span className="h-2 w-2 rounded-[1px] bg-[#1c1403] transition-transform duration-300 group-hover:rotate-45" />
      </span>
      <span className="u-display text-[1.0625rem] tracking-tight">GameSmith</span>
    </Link>
  );
}
