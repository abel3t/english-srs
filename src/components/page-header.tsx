export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}
