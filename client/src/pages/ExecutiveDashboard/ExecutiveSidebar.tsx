import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isVideoTeam } from '@/components/ProtectedRoute';

export function ExecutiveSidebar() {
  const location = useLocation();
  const { user, role } = useAuth();

  // A helper to determine if a route is active
  const isActive = (path: string) => location.pathname.startsWith(path);

  // Mirrors the requiredRole gate on each <Route> in App.tsx / the
  // server-side requireRole check. Previously this sidebar showed every
  // link to every staff role regardless of permission — clicking one you
  // didn't have access to silently bounced you back to your own dashboard
  // via ProtectedRoute's dashboardForRole() redirect, with no explanation.
  // Hiding the link up front avoids that dead-end click entirely.
  const userRoles = [role, ...((user as any)?.roles || [])].filter(Boolean);
  const can = (allowed: string[]) => allowed.some(r => userRoles.includes(r));

  const videoTeam = !can(['admin']) && isVideoTeam(user);
  const isManager = can(['admin']) || (user as any)?.canViewOversight === true;
  const adminPaths = ['/admin/oversight', '/admin/team', '/admin/logs', '/admin/clients-cleanup', '/admin/attendance', '/admin/crash-logs'];
  const onAdminPage = adminPaths.some(p => location.pathname.startsWith(p));
  const [adminOpen, setAdminOpen] = useState<boolean>(onAdminPage);
  useEffect(() => { if (onAdminPage) setAdminOpen(true); }, [onAdminPage]);

  // Oct 19 2026 (Rahul's voice note 2): the sidebar slides away so DT gets the
  // wider screen. Collapses by itself on the Decision Tree; the toggle
  // remembers your choice on every other page.
  const onDT = location.pathname.startsWith('/command-center');
  const readPref = () => { try { return localStorage.getItem('robin:sidebar:collapsed') === '1'; } catch { return false; } };
  const [collapsed, setCollapsed] = useState<boolean>(onDT || readPref());
  useEffect(() => { setCollapsed(onDT || readPref()); }, [onDT]);
  const toggleCollapsed = () => setCollapsed(c => {
    const n = !c;
    if (!onDT) { try { localStorage.setItem('robin:sidebar:collapsed', n ? '1' : '0'); } catch { /* storage blocked */ } }
    return n;
  });

  return (
    <aside
      data-collapsed={collapsed ? '1' : '0'}
      className={`${collapsed ? 'w-16 [&_.truncate]:hidden [&_.sb-label]:hidden [&_nav>div:not(.sb-group)]:hidden [&_nav_a]:justify-center [&_nav_a]:px-0 [&_nav_button]:justify-center [&_nav_button]:px-0' : 'w-72'} transition-[width] duration-200 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-20 shrink-0 h-screen overflow-hidden`}
    >
      <div className="flex-1 flex flex-col min-h-0">
        {/* App Brand Header */}
        <div className={`h-16 flex items-center ${collapsed ? 'px-3 justify-center' : 'px-6'} border-b border-slate-800 bg-slate-900/50 shrink-0`}>
          <Link to="/" className={`flex items-center gap-3 ${collapsed ? '' : 'w-full'}`}>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/30">
              <i className="fa-solid fa-robot text-sm"></i>
            </div>
            <div className="sb-label">
              <h1 className="font-bold text-base tracking-tight text-white">Robin OS</h1>
              <p className="text-xs text-slate-400">Hashtag Creator Agency</p>
            </div>
          </Link>
        </div>

        <button
          type="button" onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="mx-auto mt-2 w-8 h-7 shrink-0 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <i className={`fa-solid ${collapsed ? 'fa-angles-right' : 'fa-angles-left'} text-xs`}></i>
        </button>

        {/* Navigation Links */}
        <nav className={`${collapsed ? 'p-2' : 'p-4'} space-y-1.5 overflow-y-auto flex-1`}>
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-3 pb-2">Core Navigation</div>
          
          {/* Oct 19 2026 — owner: "this is the only tasks they have to do". */}
          {videoTeam && (
            <Link title="My tasks" to="/video-tasks" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/video-tasks') ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-list-check w-5 text-center text-rose-400"></i>
              <span className="truncate">My tasks</span>
            </Link>
          )}

          <Link title="CRM Pipeline" 
            to="/clients/pipeline" 
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/clients/pipeline') ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}
          >
            <i className="fa-solid fa-address-book w-5 text-center"></i>
            <span className="truncate">CRM Pipeline</span>
          </Link>

          <Link title="Decision Tree (DT)" 
            to="/command-center" 
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/command-center') ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}
          >
            <i className="fa-solid fa-diagram-project w-5 text-center text-blue-400"></i>
            <span className="truncate">Decision Tree (DT)</span>
          </Link>

          {/* Oct 2026 — video tasks (Day 1 → Day 7 per brand). The video team's
              own entry ("My tasks") sits at the very top instead. */}
          {!videoTeam && can(['admin', 'employee', 'sales', 'workroom']) && (
            <Link title="Video tasks" to="/video-tasks" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/video-tasks') ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-clapperboard w-5 text-center text-rose-400"></i>
              <span className="truncate">Video tasks</span>
            </Link>
          )}

          {can(['admin', 'employee', 'sales', 'workroom', 'client']) && (
            <div className="pt-4 text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-3 pb-2">Operations & Management</div>
          )}


          {/* Oct 2026 — everyone's own attendance calendar. */}
          {can(['admin', 'employee', 'sales', 'workroom']) && (
            <Link title="My attendance" to="/my-attendance" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/my-attendance') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-calendar-days w-5 text-center text-emerald-400"></i>
              <span className="truncate">My attendance</span>
            </Link>
          )}


          {/* Oct 2026 — Approvals for everyone: admins land on the review
              queue (which has an "Apply for leave" button); everyone else
              lands straight on the apply-for-leave form + their requests. */}
          {can(['admin', 'employee', 'sales', 'workroom']) && (() => {
            const to = can(['admin']) ? '/admin/leaves' : '/leaves';
            const active = isActive('/admin/leaves') || isActive('/leaves');
            return (
              <Link title={can(['admin']) ? 'Approvals' : 'Approvals · Apply leave'} to={to} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
                <i className="fa-solid fa-stamp w-5 text-center text-amber-400"></i>
                <span className="truncate">{can(['admin']) ? 'Approvals' : 'Approvals · Apply leave'}</span>
              </Link>
            );
          })()}

          {can(['admin', 'employee', 'sales', 'workroom']) && (
            <Link title="Incentives" to="/incentives" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/incentives') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-indian-rupee-sign w-5 text-center text-emerald-400"></i>
              <span className="truncate">Incentives</span>
            </Link>
          )}


          {!videoTeam && can(['admin', 'employee', 'sales']) && (
            <Link title="Process Training" to="/workroom-onboard" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/workroom-onboard') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-graduation-cap w-5 text-center text-indigo-400"></i>
              <span className="truncate">Process Training</span>
            </Link>
          )}

          {!videoTeam && can(['admin', 'employee', 'sales', 'workroom']) && (
            <Link title="Workroom" to="/workroom" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/workroom') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-users-rectangle w-5 text-center text-rose-400"></i>
              <span className="truncate">Workroom</span>
            </Link>
          )}

          {can(['admin', 'sales']) && (
            <Link title="Sales Pipeline" to="/sales" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/sales') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-bullseye w-5 text-center text-orange-400"></i>
              <span className="truncate">Sales Pipeline</span>
            </Link>
          )}

          {/* Oct 19 2026 — owner: "too much oversight / clutter". The admin and
              manager pages live in one fold-away group instead of the main list. */}
          {isManager && (
            <>
              <button
                type="button" onClick={() => setAdminOpen(o => !o)} aria-expanded={adminOpen} title="Admin"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800/80 hover:text-white transition-all"
              >
                <i className="fa-solid fa-user-shield w-5 text-center text-sky-400"></i>
                <span className="truncate">Admin</span>
                <i className={`sb-label fa-solid fa-chevron-down text-[10px] ml-auto transition-transform ${adminOpen ? 'rotate-180' : ''}`}></i>
              </button>
              {adminOpen && (
                <div className="sb-group space-y-1.5">
          {/* Oct 2026 — Team Oversight: admin + managers granted access (Rahul). */}
          {(can(['admin']) || (user as any)?.canViewOversight === true) && (
            <Link title="Team Oversight" to="/admin/oversight" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/oversight') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-binoculars w-5 text-center text-sky-400"></i>
              <span className="truncate">Team Oversight</span>
            </Link>
          )}

          {(can(['admin']) || (user as any)?.canViewOversight === true) && (
            <Link title="Team & roles" to="/admin/team" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/team') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-people-group w-5 text-center text-sky-400"></i>
              <span className="truncate">Team & roles</span>
            </Link>
          )}
          {(can(['admin']) || (user as any)?.canViewOversight === true) && (
            <Link title="Activity logs" to="/admin/logs" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/logs') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-clock-rotate-left w-5 text-center text-sky-400"></i>
              <span className="truncate">Activity logs</span>
            </Link>
          )}
          {(can(['admin']) || (user as any)?.canViewOversight === true) && (
            <Link title="Clean up clients" to="/admin/clients-cleanup" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/clients-cleanup') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-broom w-5 text-center text-amber-400"></i>
              <span className="truncate">Clean up clients</span>
            </Link>
          )}
          {can(['admin']) && (
            <Link title="Attendance" to="/admin/attendance" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/attendance') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-calendar-check w-5 text-center text-emerald-400"></i>
              <span className="truncate">Attendance</span>
            </Link>
          )}
          {can(['admin']) && (
            <Link title="Tech Updates" to="/admin/crash-logs" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/crash-logs') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
              <i className="fa-solid fa-code-branch w-5 text-center text-cyan-400"></i>
              <span className="truncate">Tech Updates</span>
            </Link>
          )}
                </div>
              )}
            </>
          )}
        </nav>
      </div>

      {/* Oct 2026 — moved here from a floating pill that overlapped this footer. */}
      {can(['admin', 'sales', 'employee']) && (
        <div className={`${collapsed ? 'px-2' : 'px-4'} pb-3 shrink-0`}>
          <button
            type="button"
            aria-label="Assign task"
            onClick={() => window.dispatchEvent(new Event('robin:assign-task'))}
            title="Assign a task to anyone (press 't' anywhere)"
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition"
          >
            <i className="fa-solid fa-plus text-blue-400"></i><span className="sb-label">Assign task</span>
            <kbd className="sb-label ml-auto text-[10px] text-slate-400 border border-slate-600 rounded px-1.5">T</kbd>
          </button>
        </div>
      )}

      {/* User Footer Profile */}
      <div className={`${collapsed ? 'p-3 justify-center' : 'p-4 justify-between'} border-t border-slate-800 bg-slate-900/80 flex items-center shrink-0`}>
        <Link to="/profile" className="flex items-center gap-3 hover:opacity-80 transition">
          <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-blue-400 overflow-hidden">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : user?.name?.charAt(0) || 'U'}
          </div>
          <div className="sb-label">
            <p className="text-xs font-semibold text-white truncate max-w-[120px]">{user?.name || 'User'}</p>
            <p className="text-[10px] text-slate-400 uppercase">{user?.role || 'Guest'}</p>
          </div>
        </Link>
        <div className="sb-label flex items-center gap-1" title="Connected">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
      </div>
    </aside>
  );
}
