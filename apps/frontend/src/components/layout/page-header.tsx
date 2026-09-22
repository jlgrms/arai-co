interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-aligned actions (buttons, filters). */
  actions?: React.ReactNode;
}

/**
 * Consistent page title block for every authenticated screen so hierarchy is
 * uniform across patient / doctor / admin surfaces.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
