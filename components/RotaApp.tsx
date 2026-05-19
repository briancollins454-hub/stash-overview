// ─── RotaApp ───────────────────────────────────────────────────────────────
// Top-level "Rota" tab. Routes between manager screens (planner, employees,
// time-off inbox, closures, import) for management roles and the staff
// surface for everyone else. Lazy-loads heavy children to keep the bundle
// reasonable.

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Users, Inbox, Plane, Upload, UserCheck, Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { RotaPlanner } from './rota/RotaPlanner';
import { RotaEmployees } from './rota/RotaEmployees';
import { RotaTimeOffInbox } from './rota/RotaTimeOffInbox';
import { RotaClosures } from './rota/RotaClosures';
import { RotaCloudImporter } from './rota/RotaCloudImporter';
import { RotaStaffSurface } from './rota/RotaStaffSurface';

export interface RotaAppProps {
    currentUser: {
        id: string;
        username: string;
        displayName: string;
        role: string;
        email?: string;
    };
    /** When true, render only the staff "my rota" surface (no manager tabs). */
    forceStaffOnly?: boolean;
}

type RotaSubTab = 'planner' | 'employees' | 'time-off' | 'closures' | 'import' | 'me';

const MANAGER_SUB_TABS: { id: RotaSubTab; label: string; icon: typeof CalendarRange }[] = [
    { id: 'planner', label: 'Week planner', icon: CalendarRange },
    { id: 'time-off', label: 'Time off', icon: Inbox },
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'closures', label: 'Closures', icon: Plane },
    { id: 'me', label: 'My rota', icon: UserCheck },
    { id: 'import', label: 'Import', icon: Upload },
];

export const RotaApp: React.FC<RotaAppProps> = ({ currentUser, forceStaffOnly }) => {
    const isManager = !forceStaffOnly && ['superuser', 'admin', 'manager'].includes(currentUser.role);
    const [searchParams, setSearchParams] = useSearchParams();
    const initialSub = (searchParams.get('sub') as RotaSubTab) || (isManager ? 'planner' : 'me');
    const [activeSub, setActiveSub] = useState<RotaSubTab>(initialSub);

    // Keep the URL ?sub= in sync so deep links (especially from email
    // notifications) land on the right pane. Replace, not push, so the
    // browser back button doesn't gather one entry per pane switch.
    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        if (activeSub === (isManager ? 'planner' : 'me')) next.delete('sub');
        else next.set('sub', activeSub);
        setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSub]);

    if (!isManager) {
        return (
            <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
                <RotaStaffSurface currentUser={currentUser} />
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
            <header className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.25em] opacity-80">Stash · Rota</p>
                            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">Team scheduling</h1>
                        </div>
                        <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-80">
                            <span className="px-2 py-1 rounded bg-white/15">Salaried staff</span>
                            <span className="px-2 py-1 rounded bg-white/15">{currentUser.displayName}</span>
                        </div>
                    </div>
                </div>
                <nav className="max-w-7xl mx-auto px-2 sm:px-4 flex gap-1 overflow-x-auto">
                    {MANAGER_SUB_TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeSub === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveSub(tab.id)}
                                className={`flex items-center gap-2 px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-t-lg transition-all whitespace-nowrap ${
                                    isActive
                                        ? 'bg-slate-50 text-teal-700 shadow-inner'
                                        : 'text-white/80 hover:bg-white/15 hover:text-white'
                                }`}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                {activeSub === 'planner' && <RotaPlanner currentUser={currentUser} />}
                {activeSub === 'time-off' && <RotaTimeOffInbox currentUser={currentUser} />}
                {activeSub === 'employees' && <RotaEmployees currentUser={currentUser} />}
                {activeSub === 'closures' && <RotaClosures currentUser={currentUser} />}
                {activeSub === 'me' && <RotaStaffSurface currentUser={currentUser} chromeless />}
                {activeSub === 'import' && <RotaCloudImporter currentUser={currentUser} />}
            </main>
        </div>
    );
};

export const RotaAppLoading: React.FC = () => (
    <div className="flex justify-center p-20">
        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
    </div>
);

export default RotaApp;
