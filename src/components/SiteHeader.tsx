import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";
import { Wordmark } from "./Wordmark";

export { Wordmark };

export async function SiteHeader({ active }: { active?: "gallery" | "dashboard" }) {
  const user = await getCurrentUser();

  const link = (href: string, label: string, key: string) => (
    <Link
      href={href}
      className={`u-label transition-colors hover:text-text ${active === key ? "!text-amber" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Wordmark />

        <nav className="ml-2 hidden items-center gap-5 sm:flex">
          {link("/", "Arcade", "gallery")}
          {user ? link("/dashboard", "Your games", "dashboard") : null}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden text-[0.8125rem] text-muted md:inline">{user.display_name}</span>
              <LogoutButton />
              <Link href="/dashboard" className="btn btn-primary btn-sm">
                Open studio
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Start building
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
