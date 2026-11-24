import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function reportUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

const components: Components = {
  img: ({ alt }) => <span>{alt}</span>,
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

// Reports contain untrusted web content. Do not load images or expose local file actions.
export function ResearchReport({ text }: { text: string }) {
  return (
    <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={reportUrl}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
