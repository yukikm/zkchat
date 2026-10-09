import { useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <button
        className="copy-code"
        onClick={async (e) => {
          const code =
            e.currentTarget.parentElement?.querySelector("code")?.textContent ??
            "";
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
        aria-label="Copy code"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="muted">[Image: {alt ?? "External image"}]</span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
