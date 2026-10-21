import { Link } from '@tanstack/react-router';

const navItems = [
  { to: '/', label: 'Today' },
  { to: '/practice', label: 'Practice' },
  { to: '/stories', label: 'Stories' },
  { to: '/library', label: 'Library' },
] as const;

export function AppNav() {
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-1">
      <Link to="/" className="mr-auto font-bold">English SRS</Link>
      {navItems.map(item => (
        <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === '/' }}
          className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          activeProps={{ className: 'bg-muted !text-foreground font-medium' }}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
