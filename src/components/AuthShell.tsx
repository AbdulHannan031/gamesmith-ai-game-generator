import { Wordmark } from "./Wordmark";

/** Auth sits inside a darkened cabinet — same housing, lights down. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="flex flex-col px-5 py-7 sm:px-10">
        <Wordmark />
        <div className="flex flex-1 items-center justify-center py-12">{children}</div>
      </div>

      <div
        className="relative hidden overflow-hidden border-l border-line lg:block"
        style={{ background: "radial-gradient(120% 90% at 70% 15%, #1f1a2e, #100e14 55%, #08070a)" }}
        aria-hidden
      >
        <div className="absolute inset-0 opacity-[0.55]">
          {Array.from({ length: 18 }).map((_, i) => {
            const hue = (i * 37 + 20) % 360;
            const size = 26 + ((i * 53) % 90);
            return (
              <span
                key={i}
                className="absolute rounded-[6px]"
                style={{
                  left: `${(i * 29) % 92}%`,
                  top: `${(i * 47) % 88}%`,
                  width: size,
                  height: size * 0.62,
                  background: `linear-gradient(160deg, hsl(${hue} 70% 46% / 0.5), transparent)`,
                  boxShadow: `0 0 0 1px hsl(${hue} 70% 60% / 0.22)`,
                  transform: `rotate(${(i % 5) - 2}deg)`,
                }}
              />
            );
          })}
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_20%,#08070a_85%)]" />
      </div>
    </div>
  );
}
