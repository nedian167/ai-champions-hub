import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { Avatar } from './ui';
import { APP_VERSION } from '../version';

const NAV: { to: string; label: string; icon: string; adminOnly?: boolean }[] = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/champions', label: 'Champions', icon: '🧑\u200d🚀' },
  { to: '/campaigns', label: 'Campaigns', icon: '📣' },
  { to: '/activities', label: 'Activities', icon: '🎯' },
  { to: '/events', label: 'Events', icon: '📅' },
  { to: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { to: '/requests', label: 'Requests', icon: '📨' },
  { to: '/reports', label: 'Reports', icon: '📊', adminOnly: true },
  { to: '/customize', label: 'Customize', icon: '🎨' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

const TITLES: Record<string, string> = {
  '/': 'Home',
  '/champions': 'Champions',
  '/campaigns': 'Campaigns',
  '/activities': 'Activities',
  '/events': 'Events',
  '/leaderboard': 'Leaderboard',
  '/requests': 'Requests',
  '/reports': 'Reports',
  '/customize': 'Customize',
  '/settings': 'Settings',
};

function CommunityButton() {
  const { settings } = useAppData();
  const url = settings?.abs_copilotcommunityurl;
  const name = settings?.abs_communityname?.trim() || 'AI Champions Community';
  if (!url) return null;
  return (
    <a className="community-btn" href={url} target="_blank" rel="noreferrer">
      💬 {name}
    </a>
  );
}

export default function Layout() {
  const { currentUser, currentChampion, isProgramManager, isAppAdmin, isAdmin, settings } = useAppData();
  const loc = useLocation();
  const base = '/' + (loc.pathname.split('/')[1] ?? '');
  const title = TITLES[base] ?? 'AI Champions Hub';
  const name = currentChampion?.crd49_displayname || currentUser?.fullName || 'Guest';
  const role = isProgramManager ? 'Program Manager' : isAppAdmin ? 'App Admin' : 'Champion';
  const navItems = NAV.filter((n) => !n.adminOnly || isAdmin);
  const logo = settings?.abs_applogo?.trim();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          {logo ? (
            <img className="brand-logo brand-logo-img" src={logo} alt="App logo" />
          ) : (
            <span className="brand-logo">🤖</span>
          )}
          <span>AI Champions Hub</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>Empowering AI adoption, one champion at a time.</div>
          <div className="sidebar-version">v{APP_VERSION}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{title}</div>
          <div className="topbar-user">
            <span className="role-badge">{role}</span>
            <Avatar name={name} size={34} />
            <span className="strong">{name}</span>
          </div>
        </header>
        <main>
          <div className="page">
            <Outlet />
          </div>
        </main>
      </div>
      <CommunityButton />
    </div>
  );
}
