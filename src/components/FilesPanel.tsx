"use client";

import { useEffect, useState } from "react";
import type { FileMap } from "@/lib/types";
import { IconFile } from "./icons";

export function FilesPanel({ files }: { files: FileMap }) {
  const paths = Object.keys(files).sort();
  const [selected, setSelected] = useState(paths[0] ?? "");

  useEffect(() => {
    if (!files[selected] && paths.length) setSelected(paths[0]);
  }, [files, selected, paths]);

  const content = files[selected] ?? "";
  const lines = content.split("\n");

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-52 shrink-0 overflow-y-auto border-r border-line py-2">
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            onClick={() => setSelected(path)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.8125rem] transition-colors ${
              path === selected ? "bg-surface-2 text-text" : "text-muted hover:text-text"
            }`}
          >
            <IconFile className="h-3.5 w-3.5 shrink-0 text-dim" />
            <span className="truncate">{path}</span>
          </button>
        ))}
        {paths.length === 0 ? <p className="px-3 py-2 text-[0.8125rem] text-dim">No files.</p> : null}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          <span className="u-num text-[0.75rem] text-muted">{selected}</span>
          <span className="u-label ml-auto">{lines.length} lines</span>
        </div>
        <pre className="overflow-x-auto px-4 py-3 text-[0.75rem] leading-[1.65]">
          <code className="u-num block">
            {lines.map((line, i) => (
              <span key={i} className="grid grid-cols-[3ch_1fr] gap-4">
                <span className="select-none text-right text-dim">{i + 1}</span>
                <span className="whitespace-pre text-[#ded7d2]">{line || " "}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
