import clsx from 'clsx';

/**
 * A section of a page, on the card the Flow page uses: an eyebrow naming it,
 * an optional line beneath, an optional control on the right, then the
 * content. Every page is built from these, spread across the width beside
 * the sidebar (docs/design/OVERHAUL.md, ask 13).
 *
 * No hooks, so it serves server pages and client components alike.
 */
export function Card({
  label,
  title,
  action,
  id,
  className,
  children,
}: {
  /** What the section is, as an eyebrow; also its accessible name. */
  label: string;
  /** A line under the label: a total, a date range. */
  title?: React.ReactNode;
  /** A control that belongs to the whole section, at its top right. */
  action?: React.ReactNode;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const heading = `${id ?? slug(label)}-heading`;
  return (
    <section id={id} aria-labelledby={heading} className={clsx('card px-5 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id={heading} className="eyebrow">{label}</h2>
          {title && <div className="mt-1 text-lg font-semibold tracking-tight text-ink">{title}</div>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const slug = (s: string) => `card-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
