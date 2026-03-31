
import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  icon: React.ReactNode;
  colorClass: string;
  onClick?: () => void;
  isActive?: boolean;
  subStat?: React.ReactNode;
  children?: React.ReactNode; // Slot for extra interactive elements
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, trend, trendLabel, icon, colorClass, onClick, isActive, subStat, children }) => {
  return (
    <div 
        onClick={onClick}
        className={`bg-white rounded-xl shadow-sm p-6 border transition-all duration-200 flex flex-col justify-between ${
            isActive 
            ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-md' 
            : 'border-gray-100 hover:border-indigo-200'
        } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="stats-title text-sm font-bold text-gray-500">{title}</p>
          <div className={`p-3 rounded-full ${colorClass} bg-opacity-10`}>
            {React.isValidElement(icon) 
              ? React.cloneElement(icon as React.ReactElement<any>, { className: `w-6 h-6 ${colorClass.replace('bg-', 'text-')}` })
              : icon
            }
          </div>
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-1">{value}</h3>
      </div>
      
      <div className="space-y-3">
        {children && (
            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        )}

        {trend && (
            <div className="flex items-center text-xs mb-2">
            {trend === 'up' && <ArrowUpRight className="w-3 h-3 text-green-500 mr-1" />}
            {trend === 'down' && <ArrowDownRight className="w-3 h-3 text-red-500 mr-1" />}
            {trend === 'neutral' && <Minus className="w-3 h-3 text-gray-400 mr-1" />}
            <span className={`font-medium ${
                trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-500'
            }`}>
                {trendLabel}
            </span>
            <span className="text-gray-400 ml-1">vs last week</span>
            </div>
        )}
        
        {subStat && (
            <div className="pt-2 border-t border-gray-100 mt-2">
                {subStat}
            </div>
        )}
      </div>
    </div>
  );
};

export default StatsCard;
