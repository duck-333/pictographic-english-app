import { Outlet, NavLink, useLocation } from 'react-router';
import { Search, Share2, BookOpen, GraduationCap } from 'lucide-react';
import { MascotBubble } from './MascotBubble';

const NAV_ITEMS = [
  { path: '/', label: '查词', icon: Search, exact: true },
  { path: '/network', label: '关系网', icon: Share2 },
  { path: '/word-list', label: '单词库', icon: BookOpen },
  { path: '/classroom', label: '课堂', icon: GraduationCap },
];

export function Layout() {
  const location = useLocation();

  return (
    <div
      className="min-h-screen flex items-start justify-center"
      style={{ background: 'linear-gradient(135deg, #C8DFF0 0%, #B5CCD8 100%)' }}
    >
      <div
        className="relative w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: 430,
          minHeight: '100svh',
          background: '#F0F9FF',
          fontFamily: "'Noto Sans SC', system-ui, sans-serif",
        }}
      >
        {/* Page content */}
        <div className="flex-1 overflow-y-auto pb-20" style={{ scrollbarWidth: 'none' }}>
          <Outlet />
        </div>

        {/* Mascot floating assistant */}
        <MascotBubble />

        {/* Bottom Navigation */}
        <nav
          className="fixed bottom-0 left-1/2"
          style={{
            width: 430,
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(12px)',
            borderTop: '1px solid rgba(169,226,255,0.25)',
            boxShadow: '0 -4px 20px rgba(14,58,92,0.07)',
            zIndex: 50,
            maxWidth: '100vw',
          }}
        >
          <div className="flex items-center justify-around px-4 py-2">
            {NAV_ITEMS.map(({ path, label, icon: Icon, exact }) => {
              const isActive = exact ? location.pathname === path : location.pathname.startsWith(path);
              return (
                <NavLink
                  key={path}
                  to={path}
                  className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all duration-200"
                  style={{ color: isActive ? '#0E3A5C' : '#6BAED6', minWidth: 60 }}
                >
                  <div className="relative">
                    <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                    {isActive && (
                      <div
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full"
                        style={{ width: 4, height: 4, background: '#FE8500' }}
                      />
                    )}
                  </div>
                  <span className="text-xs mt-1" style={{ fontWeight: isActive ? 600 : 400, fontSize: 11 }}>
                    {label}
                  </span>
                </NavLink>
              );
            })}
          </div>
          {/* iOS safe area */}
          <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
        </nav>
      </div>
    </div>
  );
}