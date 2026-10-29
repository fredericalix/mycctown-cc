import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
// `?raw` keeps docs/user-guide.md as the single source of truth: editing
// the markdown file updates the web page on the next build.
import userGuideRaw from '../../../../docs/user-guide.md?raw';
import 'highlight.js/styles/github.css';
import { useAuthStore } from '../../stores/useAuthStore';

/**
 * Tailwind / Next.js-style doc layout:
 * - Left sidebar with section nav auto-extracted from H2 headings.
 * - Main content ~860px max, 17px body, 1.75 line-height.
 * - Anchor links on H2/H3 (link icon on hover).
 * - Code blocks with syntax highlighting + copy button.
 * - Floating back-to-top button once scrolled.
 *
 * Light theme aligned with the Clever Cloud developer docs — white
 * background, #a51050 primary for links and accents, Plus Jakarta Sans
 * body with Rajdhani over-titles.
 */

interface HeadingRef {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/** Extract H2 + H3 lines from the markdown source for the left sidebar. */
function extractHeadings(md: string): HeadingRef[] {
  const rows: HeadingRef[] = [];
  const lines = md.split('\n');
  let inCodeBlock = false;
  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const m2 = /^##\s+(.+?)\s*$/.exec(raw);
    if (m2) {
      rows.push({ id: slugify(m2[1]!), text: m2[1]!, level: 2 });
      continue;
    }
    const m3 = /^###\s+(.+?)\s*$/.exec(raw);
    if (m3) {
      rows.push({ id: slugify(m3[1]!), text: m3[1]!, level: 3 });
    }
  }
  return rows;
}

function textOfChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOfChildren).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    const p = (children as { props: { children?: React.ReactNode } }).props;
    return textOfChildren(p.children);
  }
  return '';
}

export function DocsPage() {
  const source = useProcessedMarkdown();
  const headings = useMemo(() => extractHeadings(userGuideRaw), []);
  const authStatus = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  // Global CSS forces html/body/#root to exactly viewport height (for the
  // 3D scene), which kills window scrolling. We scroll inside this div
  // instead.
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authStatus === 'idle') refresh();
  }, [authStatus, refresh]);

  // Track which heading is closest to the top of the scroll container so
  // we can highlight it in the left sidebar.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = (visible[0]!.target as HTMLElement).id;
          if (id) setActiveId(id);
        }
      },
      { root, rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    const h2s = root.querySelectorAll('.docs-content h2[id], .docs-content h3[id]');
    h2s.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [source]);

  // Back-to-top visibility — listens on the container, not window.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowTop(el.scrollTop > 600);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={scrollRef}
      className="h-full w-full docs-page"
      style={{
        background: '#ffffff',
        color: '#13172e',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <DocsHeader />
      <div className="mx-auto max-w-[1100px] grid-cols-1 md:grid-cols-[220px_1fr] gap-10 px-6 py-10 pb-24 grid">
        <DocsSidebar headings={headings} activeId={activeId} />
        <article className="docs-content min-w-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
            components={DOCS_COMPONENTS}
          >
            {source}
          </ReactMarkdown>
        </article>
      </div>
      <DocsFooter />
      {showTop && <BackToTop scrollTarget={scrollRef} />}
      <DocsStyles />
    </div>
  );
}

function DocsHeader() {
  return (
    <header
      className="sticky top-0 z-20"
      style={{
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid #ededf2',
      }}
    >
      <div className="mx-auto max-w-[1100px] h-14 px-6 flex items-center">
        <Link to="/" className="flex items-baseline gap-3 select-none">
          <span
            className="text-xl font-semibold"
            style={{ color: '#13172e', letterSpacing: '-0.02em' }}
          >
            myCCtown
          </span>
          <span className="font-overtitle text-[10px]" style={{ color: '#a51050' }}>
            Documentation
          </span>
        </Link>
      </div>
    </header>
  );
}

function DocsSidebar({
  headings,
  activeId,
}: {
  headings: HeadingRef[];
  activeId: string | null;
}) {
  return (
    <aside
      className="hidden md:block"
      style={{
        position: 'sticky',
        top: '72px',
        alignSelf: 'start',
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
      }}
    >
      <div
        className="font-overtitle mb-3"
        style={{ color: '#a51050', fontSize: '0.7rem' }}
      >
        Guide
      </div>
      <nav>
        <ul className="flex flex-col gap-1 list-none p-0 m-0">
          {headings.map((h) => {
            const isActive = activeId === h.id;
            return (
              <li key={h.id}>
                <a
                  href={`#${h.id}`}
                  className="block rounded-md px-3 py-1.5 transition"
                  style={{
                    paddingLeft: h.level === 3 ? '1.75rem' : '0.75rem',
                    color: isActive ? '#a51050' : h.level === 3 ? '#73738e' : '#2a2e4a',
                    background: isActive ? 'rgba(165,16,80,0.06)' : 'transparent',
                    fontSize: h.level === 3 ? '0.82rem' : '0.9rem',
                    fontWeight: isActive ? 600 : h.level === 3 ? 400 : 500,
                    textDecoration: 'none',
                    borderLeft: isActive ? '2px solid #a51050' : '2px solid transparent',
                    lineHeight: 1.4,
                  }}
                >
                  {h.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function DocsFooter() {
  return (
    <footer
      className="py-6 text-center text-xs"
      style={{
        color: '#73738e',
        borderTop: '1px solid #ededf2',
        background: '#fafafc',
      }}
    >
      Built on{' '}
      <a
        href="https://www.clever-cloud.com/"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#a51050' }}
      >
        Clever Cloud
      </a>
      . Medieval art by{' '}
      <a
        href="https://kaylousberg.com/game-assets"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#a51050' }}
      >
        Kay Lousberg
      </a>
      .
    </footer>
  );
}

function BackToTop({ scrollTarget }: { scrollTarget: React.RefObject<HTMLDivElement | null> }) {
  return (
    <button
      onClick={() =>
        scrollTarget.current?.scrollTo({ top: 0, behavior: 'smooth' })
      }
      className="fixed right-6 bottom-6 rounded-full shadow-lg transition z-30"
      style={{
        background: '#a51050',
        color: '#ffffff',
        width: 42,
        height: 42,
        fontSize: 18,
        border: 'none',
        boxShadow: '0 4px 16px rgba(165,16,80,0.35)',
      }}
      aria-label="Back to top"
      title="Back to top"
    >
      ↑
    </button>
  );
}

function useProcessedMarkdown(): string {
  // Rewrite image paths so they resolve to `/docs/img/…` when served.
  return useMemo(() => {
    return userGuideRaw.replace(
      /!\[([^\]]*)\]\(\.\/img\/([^)]+)\)/g,
      '![$1](/docs/img/$2)',
    );
  }, []);
}

/** H2/H3 with an anchor link + auto-generated id. */
function Heading({
  level,
  children,
}: {
  level: 2 | 3;
  children: React.ReactNode;
}) {
  const id = slugify(textOfChildren(children));
  const base: React.CSSProperties = {
    color: '#13172e',
    letterSpacing: '-0.01em',
    scrollMarginTop: '80px',
  };
  if (level === 2) {
    return (
      <h2
        id={id}
        className="doc-h group mt-14 mb-4 font-semibold"
        style={{
          ...base,
          fontSize: '1.6rem',
          lineHeight: 1.25,
          borderBottom: '1px solid #ededf2',
          paddingBottom: '0.4rem',
        }}
      >
        {children}
        <a
          href={`#${id}`}
          className="doc-anchor ml-2"
          aria-label="Anchor link"
          style={{ color: '#a51050', textDecoration: 'none' }}
        >
          #
        </a>
      </h2>
    );
  }
  return (
    <h3
      id={id}
      className="doc-h group mt-10 mb-3 font-semibold"
      style={{ ...base, fontSize: '1.2rem', lineHeight: 1.3 }}
    >
      {children}
      <a
        href={`#${id}`}
        className="doc-anchor ml-2"
        aria-label="Anchor link"
        style={{ color: '#a51050', textDecoration: 'none' }}
      >
        #
      </a>
    </h3>
  );
}

/** <pre> wrapper with a copy button that appears on hover. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const el = ref.current;
    if (!el) return;
    const text = el.innerText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be blocked
    }
  };

  return (
    <div className="my-5 relative group">
      <pre
        ref={ref}
        className="p-4 rounded-lg overflow-x-auto"
        style={{
          background: '#13172e',
          color: '#f1f0fb',
          fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', monospace",
          fontSize: '0.87rem',
          lineHeight: 1.6,
        }}
      >
        {children}
      </pre>
      <button
        onClick={copy}
        className="doc-copy absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-medium transition opacity-0 group-hover:opacity-100"
        style={{
          background: copied ? '#11bea9' : 'rgba(241,240,251,0.15)',
          color: '#f1f0fb',
          border: '1px solid rgba(241,240,251,0.2)',
          fontFamily: 'inherit',
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

const DOCS_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1
      className="mt-0 mb-2 font-bold"
      style={{
        color: '#13172e',
        fontSize: '2.5rem',
        lineHeight: 1.15,
        letterSpacing: '-0.025em',
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  h4: ({ children }) => (
    <h4
      className="mt-6 mb-2 font-overtitle"
      style={{ color: '#a51050', fontSize: '0.72rem' }}
    >
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="doc-p">{children}</p>,
  ul: ({ children }) => <ul className="doc-list list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="doc-list list-decimal">{children}</ol>,
  li: ({ children }) => <li className="my-2">{children}</li>,
  strong: ({ children }) => (
    <strong style={{ color: '#13172e', fontWeight: 600 }}>{children}</strong>
  ),
  em: ({ children }) => <em style={{ color: '#3a3871' }}>{children}</em>,
  a: ({ href, children }) => {
    const external = href?.startsWith('http');
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        style={{
          color: '#a51050',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
          textDecorationColor: 'rgba(165,16,80,0.35)',
        }}
      >
        {children}
      </a>
    );
  },
  code: ({ children, className }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      // Defer to the <pre> wrapper renderer; just carry the className
      // (which is `language-<name>` for rehype-highlight to colorise).
      return (
        <code className={className} style={{ color: '#f1f0fb' }}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded px-1.5 py-0.5"
        style={{
          background: '#f5f3fa',
          color: '#a51050',
          border: '1px solid #e7e5f1',
          fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', monospace",
          fontSize: '0.85em',
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  blockquote: ({ children }) => (
    <blockquote
      className="my-5 py-1"
      style={{
        borderLeft: '3px solid #a51050',
        background: 'rgba(165,16,80,0.04)',
        color: '#3a3871',
        borderRadius: '0 6px 6px 0',
        padding: '0.7rem 1rem',
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr
      className="my-12"
      style={{ borderColor: '#ededf2', borderTopWidth: '1px' }}
    />
  ),
  table: ({ children }) => (
    <div
      className="my-5 overflow-x-auto rounded-lg"
      style={{ border: '1px solid #ededf2' }}
    >
      <table className="w-full border-collapse" style={{ background: '#fff' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: '#faf9fc' }}>{children}</thead>
  ),
  th: ({ children }) => (
    <th
      className="text-left px-4 py-3 font-overtitle"
      style={{
        color: '#3a3871',
        fontSize: '0.72rem',
        borderBottom: '1px solid #ededf2',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      className="px-4 py-3 align-top"
      style={{
        color: '#2a2e4a',
        fontSize: '0.95rem',
        borderBottom: '1px solid #f1eff5',
      }}
    >
      {children}
    </td>
  ),
  img: ({ src, alt }) => {
    const [errored, setErrored] = useState(false);
    if (errored) {
      return (
        <div
          className="my-5 rounded-lg px-4 py-6 text-center"
          style={{
            color: '#73738e',
            background: '#faf9fc',
            border: '1px dashed #d4d2e1',
            fontSize: '0.9rem',
          }}
        >
          📷 Screenshot coming soon —{' '}
          <code
            style={{
              background: '#fff',
              border: '1px solid #ededf2',
              padding: '1px 6px',
              borderRadius: '3px',
            }}
          >
            {alt || src}
          </code>
        </div>
      );
    }
    return (
      <img
        src={src}
        alt={alt}
        onError={() => setErrored(true)}
        className="my-6 rounded-xl w-full"
        style={{
          border: '1px solid #ededf2',
          background: '#fff',
          boxShadow: '0 2px 16px rgba(19,23,46,0.04)',
        }}
      />
    );
  },
};

function DocsStyles() {
  return (
    <style>{`
      .docs-page,
      .docs-page .docs-content,
      .docs-page .docs-content p,
      .docs-page .docs-content li {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-feature-settings: 'kern', 'liga';
      }
      .docs-page .font-overtitle {
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      /* Comfortable reading size and rhythm. */
      .docs-page .doc-p {
        color: #2a2e4a;
        line-height: 1.75;
        font-size: 1.0625rem; /* 17px */
        margin: 1rem 0;
      }
      .docs-page .doc-list {
        color: #2a2e4a;
        line-height: 1.75;
        font-size: 1.0625rem;
        margin: 1rem 0;
        padding-left: 1.5rem;
      }
      .docs-page .doc-list li { margin: 0.4rem 0; }

      /* Anchor-link # icon, hidden until heading hover. */
      .docs-page .doc-anchor {
        opacity: 0;
        transition: opacity 120ms ease-out;
        font-weight: 400;
        font-size: 0.85em;
      }
      .docs-page .doc-h:hover .doc-anchor { opacity: 1; }
      .docs-page .doc-anchor:hover { opacity: 1; text-decoration: none; }

      /* Highlight.js theme override so inline text keeps white on navy. */
      .docs-page .hljs {
        background: transparent !important;
        padding: 0 !important;
      }
      /* Dark-ish tweaks to the default github.css light palette so it
         reads correctly on our navy pre background. */
      .docs-page pre .hljs-keyword,
      .docs-page pre .hljs-built_in,
      .docs-page pre .hljs-literal { color: #f5a5b8 !important; }
      .docs-page pre .hljs-string,
      .docs-page pre .hljs-attr { color: #a3e7d8 !important; }
      .docs-page pre .hljs-number,
      .docs-page pre .hljs-symbol { color: #f5b775 !important; }
      .docs-page pre .hljs-comment,
      .docs-page pre .hljs-quote { color: #8a8aae !important; font-style: italic; }
      .docs-page pre .hljs-type,
      .docs-page pre .hljs-title,
      .docs-page pre .hljs-class .hljs-title { color: #b5c7ff !important; }
      .docs-page pre .hljs-function,
      .docs-page pre .hljs-title.function_ { color: #fbdc88 !important; }
      .docs-page pre .hljs-variable,
      .docs-page pre .hljs-name,
      .docs-page pre .hljs-tag { color: #f1f0fb !important; }
    `}</style>
  );
}
