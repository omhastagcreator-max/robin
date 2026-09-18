import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function ExecutiveSidebar() {
  const location = useLocation();
  const { user } = useAuth();
  
  // A helper to determine if a route is active
  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <aside className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-20 shrink-0 h-screen overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0">
        {/* App Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-900/50 shrink-0">
          <Link to="/" className="flex items-center gap-3 w-full">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/30">
              <i className="fa-solid fa-robot text-sm"></i>
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white">Robin OS</h1>
              <p className="text-xs text-slate-400">Hashtag Creator Agency</p>
            </div>
          </Link>
        </div>

        {/* Navigation Links */}
        <nav className="p-4 space-y-1.5 overflow-y-auto flex-1">
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-3 pb-2">Core Navigation</div>
          
          <Link 
            to="/clients/pipeline" 
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/clients/pipeline') ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}
          >
            <i className="fa-solid fa-address-book w-5 text-center"></i>
            <span className="truncate">CRM Pipeline</span>
          </Link>

          <Link 
            to="/command-center" 
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/command-center') ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}
          >
            <i className="fa-solid fa-diagram-project w-5 text-center text-blue-400"></i>
            <span className="truncate">Decision Tree (DT)</span>
          </Link>

          <div className="pt-4 text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-3 pb-2">Operations & Management</div>

          <Link to="/admin/attendance" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/attendance') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
            <i className="fa-solid fa-calendar-check w-5 text-center text-emerald-400"></i>
            <span className="truncate">Attendance</span>
          </Link>

          <Link to="/admin/leaves" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/leaves') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
            <i className="fa-solid fa-stamp w-5 text-center text-amber-400"></i>
            <span className="truncate">Approvals</span>
          </Link>

          <Link to="/admin/crash-logs" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/admin/crash-logs') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
            <i className="fa-solid fa-code-branch w-5 text-center text-cyan-400"></i>
            <span className="truncate">Tech Updates</span>
          </Link>

          <Link to="/workroom-onboard" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/workroom-onboard') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
            <i className="fa-solid fa-graduation-cap w-5 text-center text-indigo-400"></i>
            <span className="truncate">Process Training</span>
          </Link>

          <Link to="/workroom" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/workroom') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
            <i className="fa-solid fa-users-rectangle w-5 text-center text-rose-400"></i>
            <span className="truncate">Workroom</span>
          </Link>

          <Link to="/sales" className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive('/sales') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'}`}>
            <i className="fa-solid fa-bullseye w-5 text-center text-orange-400"></i>
            <span className="truncate">Sales Pipeline</span>
          </Link>
        </nav>
      </div>

      {/* User Footer Profile */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between shrink-0">
        <Link to="/profile" className="flex items-center gap-3 hover:opacity-80 transition">
          <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-blue-400 overflow-hidden">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : user?.name?.charAt(0) || 'U'}
          </div>
          <div>
            <p className="text-xs font-semibold text-white truncate max-w-[120px]">{user?.name || 'User'}</p>
            <p className="text-[10px] text-slate-400 uppercase">{user?.role || 'Guest'}</p>
          </div>
        </Link>
        <div className="flex items-center gap-1" title="Connected">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
      </div>
    </aside>
  );
}
