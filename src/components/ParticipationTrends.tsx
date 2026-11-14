import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  BarChart3,
  Calendar,
  Users,
  Flame,
  Layers,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import { Session, CheckInRecord } from '../types';
import { useMotionSafe } from '../motion/useMotionSafe';
import { toJsDate } from '../utils/sessionWindow';

interface ParticipationTrendsProps {
  selectedMonth: string;
  monthLabel: string;
  checkIns: CheckInRecord[];
  sessions: Session[];
}

export interface WeeklyTrendData {
  weekKey: string;
  weekLabel: string;
  shortLabel: string;
  dateRange: string;
  checkIns: number;
  uniqueBuilders: number;
  sessionsCount: number;
  hardwareCount: number;
  aiCount: number;
  softwareCount: number;
  openHackCount: number;
}

export const ParticipationTrends: React.FC<ParticipationTrendsProps> = ({
  selectedMonth,
  monthLabel,
  checkIns,
  sessions,
}) => {
  const { reduced } = useMotionSafe();
  const [chartMode, setChartMode] = useState<'total' | 'tracks'>('total');

  // Compute weekly attendance trends for the selected month
  const weeklyData = useMemo<WeeklyTrendData[]>(() => {
    const parts = selectedMonth.split('-');
    const year = parseInt(parts[0], 10) || 2026;
    const month = parseInt(parts[1], 10) || 10;
    const daysInMonth = new Date(year, month, 0).getDate();

    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const monthName = monthNames[month - 1] || 'Mo';

    const weeksDef = [
      { key: 'w1', label: 'Week 1', range: `${monthName} 1 – 7`, start: 1, end: 7 },
      { key: 'w2', label: 'Week 2', range: `${monthName} 8 – 14`, start: 8, end: 14 },
      { key: 'w3', label: 'Week 3', range: `${monthName} 15 – 21`, start: 15, end: 21 },
      { key: 'w4', label: 'Week 4', range: `${monthName} 22 – 28`, start: 22, end: 28 },
      {
        key: 'w5',
        label: 'Week 5',
        range: `${monthName} 29 – ${daysInMonth}`,
        start: 29,
        end: daysInMonth,
      },
    ];

    const currentMonthCheckIns = checkIns.filter((c) => c.monthKey === selectedMonth);
    const currentMonthSessions = sessions.filter(
      (s) => s.status !== 'cancelled' && !s.deletedAt && s.date.startsWith(selectedMonth)
    );

    const sessionMap = new Map<string, Session>();
    sessions.forEach((s) => sessionMap.set(s.id, s));

    return weeksDef.map((w, index) => {
      // Find check-ins falling in this week's date range
      const inWeekCheckIns = currentMonthCheckIns.filter((c) => {
        let day = 0;
        const sess = sessionMap.get(c.sessionId);
        const dateStr = c.date || sess?.date;
        if (dateStr && dateStr.includes('-')) {
          day = parseInt(dateStr.split('-')[2], 10);
        } else if (c.checkedInAt || c.timestamp) {
          day = toJsDate(c.checkedInAt || c.timestamp).getDate();
        }
        return day >= w.start && day <= w.end;
      });

      // Find sessions in this week
      const inWeekSessions = currentMonthSessions.filter((s) => {
        const day = parseInt(s.date.split('-')[2], 10);
        return day >= w.start && day <= w.end;
      });

      const uniqueMemberIds = new Set(inWeekCheckIns.map((c) => c.memberId));

      const getTrack = (c: CheckInRecord) => (c.track || sessionMap.get(c.sessionId)?.track || '').toLowerCase();

      const hardwareCount = inWeekCheckIns.filter((c) => getTrack(c).includes('hardware')).length;
      const aiCount = inWeekCheckIns.filter((c) => getTrack(c).includes('ai') || getTrack(c).includes('embedded')).length;
      const softwareCount = inWeekCheckIns.filter((c) => getTrack(c).includes('software')).length;
      const openHackCount = inWeekCheckIns.filter((c) => getTrack(c).includes('hack') || getTrack(c).includes('demo')).length;

      return {
        weekKey: w.key,
        weekLabel: `W${index + 1}`,
        shortLabel: w.label,
        dateRange: w.range,
        checkIns: inWeekCheckIns.length,
        uniqueBuilders: uniqueMemberIds.size,
        sessionsCount: inWeekSessions.length,
        hardwareCount,
        aiCount,
        softwareCount,
        openHackCount,
      };
    });
  }, [selectedMonth, checkIns, sessions]);

  // Aggregate summary stats
  const totalMonthCheckIns = useMemo(
    () => weeklyData.reduce((acc, curr) => acc + curr.checkIns, 0),
    [weeklyData]
  );

  const peakWeek = useMemo(() => {
    return [...weeklyData].sort((a, b) => b.checkIns - a.checkIns)[0];
  }, [weeklyData]);

  const avgWeekly = useMemo(() => {
    return (totalMonthCheckIns / (weeklyData.length || 1)).toFixed(1);
  }, [totalMonthCheckIns, weeklyData]);

  // Custom Dark Cyber Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as WeeklyTrendData;
      return (
        <div className="bg-zinc-950/95 border border-[#b5ff00]/40 p-3 rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.8)] backdrop-blur-md text-xs font-sans min-w-[200px]">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800">
            <span className="font-display font-bold uppercase tracking-wider text-white text-[11px]">
              {data.shortLabel}
            </span>
            <span className="text-[10px] font-mono text-[#b5ff00]">{data.dateRange}</span>
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Total Check-ins:</span>
              <span className="font-bold text-[#b5ff00] tabular-nums text-xs">
                {data.checkIns}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Unique Builders:</span>
              <span className="font-semibold text-zinc-200 tabular-nums">
                {data.uniqueBuilders}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Sessions Hosted:</span>
              <span className="font-semibold text-zinc-300 tabular-nums">
                {data.sessionsCount}
              </span>
            </div>

            {chartMode === 'tracks' && data.checkIns > 0 && (
              <div className="pt-2 mt-1 border-t border-zinc-900 space-y-1 text-[10px]">
                <div className="flex items-center justify-between text-[#b5ff00]">
                  <span>Hardware & Robotics:</span>
                  <span className="font-bold">{data.hardwareCount}</span>
                </div>
                <div className="flex items-center justify-between text-[#00d2ef]">
                  <span>AI & Embedded:</span>
                  <span className="font-bold">{data.aiCount}</span>
                </div>
                <div className="flex items-center justify-between text-[#ac4bff]">
                  <span>Software & Systems:</span>
                  <span className="font-bold">{data.softwareCount}</span>
                </div>
                <div className="flex items-center justify-between text-amber-400">
                  <span>Open Hack & Demo:</span>
                  <span className="font-bold">{data.openHackCount}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-3xl glass-panel p-6 sm:p-7 space-y-6 spatial-card">
      {/* Top Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#b5ff00] animate-pulse" />
            <h2 className="text-base font-bold font-display uppercase tracking-tight text-white flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#b5ff00]" />
              <span>Participation Trends</span>
            </h2>
            <span className="text-[10px] font-mono text-zinc-400 bg-black/60 px-2.5 py-0.5 rounded-full border border-white/5 neu-inset">
              Weekly Check-in Velocity
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Turnout trajectory and active builder participation per week for {monthLabel}
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1.5 p-1 bg-black/60 border border-white/5 neu-inset rounded-2xl text-xs font-mono">
          <button
            onClick={() => setChartMode('total')}
            className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all cursor-pointer ${
              chartMode === 'total'
                ? 'bg-[#141720] text-[#b5ff00] neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Total Check-ins
          </button>
          <button
            onClick={() => setChartMode('tracks')}
            className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all cursor-pointer ${
              chartMode === 'tracks'
                ? 'bg-[#141720] text-[#b5ff00] neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Track Breakdown
          </button>
        </div>
      </div>

      {/* Metrics Glance Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 font-mono">
        <div className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">
            Month Check-ins
          </span>
          <span className="text-xl font-bold text-zinc-100 tabular-nums">
            {totalMonthCheckIns}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">
            Weekly Average
          </span>
          <span className="text-xl font-bold text-[#b5ff00] tabular-nums">
            {avgWeekly}
            <span className="text-xs text-zinc-500 font-normal"> /wk</span>
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">
            Peak Week
          </span>
          <span className="text-xl font-bold text-cyan-400 tabular-nums">
            {peakWeek && peakWeek.checkIns > 0 ? peakWeek.shortLabel : '—'}
            <span className="text-xs text-zinc-500 font-normal">
              {peakWeek && peakWeek.checkIns > 0 ? ` (${peakWeek.checkIns})` : ''}
            </span>
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
            Active Weeks
          </span>
          <span className="text-xl font-bold text-purple-400 tabular-nums">
            {weeklyData.filter((w) => w.checkIns > 0).length} / {weeklyData.length}
          </span>
        </div>
      </div>

      {/* Main Recharts Visualization Canvas with defined responsive height */}
      <div className="w-full h-56 sm:h-72 pt-2">
        {totalMonthCheckIns === 0 ? (
          <div className="h-full flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-xl text-center p-6 text-zinc-400 text-xs">
            <BarChart3 className="h-8 w-8 text-zinc-500 mb-2" />
            <span>No check-ins logged for {monthLabel} yet.</span>
            <span className="text-zinc-400 text-xs mt-1">
              Check in builders at the entrance kiosk or with the QR scanner to populate weekly trends.
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === 'total' ? (
              <BarChart
                data={weeklyData}
                margin={{ top: 15, right: 15, left: -20, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#27272a"
                  vertical={false}
                />
                <XAxis
                  dataKey="shortLabel"
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="checkIns"
                  name="Check-ins"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={55}
                  isAnimationActive={!reduced}
                >
                  {weeklyData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.checkIns === peakWeek?.checkIns && entry.checkIns > 0 ? '#b5ff00' : '#84cc16'}
                      opacity={entry.checkIns === peakWeek?.checkIns && entry.checkIns > 0 ? 1 : 0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <BarChart
                data={weeklyData}
                margin={{ top: 15, right: 15, left: -20, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#27272a"
                  vertical={false}
                />
                <XAxis
                  dataKey="shortLabel"
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="hardwareCount"
                  name="Hardware & Robotics"
                  stackId="tracks"
                  fill="#b5ff00"
                  maxBarSize={55}
                  isAnimationActive={!reduced}
                />
                <Bar
                  dataKey="aiCount"
                  name="AI & Embedded"
                  stackId="tracks"
                  fill="#00d2ef"
                  maxBarSize={55}
                  isAnimationActive={!reduced}
                />
                <Bar
                  dataKey="softwareCount"
                  name="Software & Systems"
                  stackId="tracks"
                  fill="#ac4bff"
                  maxBarSize={55}
                  isAnimationActive={!reduced}
                />
                <Bar
                  dataKey="openHackCount"
                  name="Open Hack & Demo"
                  stackId="tracks"
                  fill="#f59e0b"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={55}
                  isAnimationActive={!reduced}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Week Breakdown Cards & Legend (horizontally scrollable on mobile) */}
      <div className="flex sm:grid overflow-x-auto sm:overflow-visible sm:grid-cols-5 gap-2 pt-2 border-t border-zinc-800/80 pb-1">
        {weeklyData.map((item) => (
          <div
            key={item.weekKey}
            className={`min-w-[130px] sm:min-w-0 shrink-0 sm:shrink p-2.5 rounded-xl border text-xs transition-all ${
              item.checkIns === peakWeek?.checkIns && item.checkIns > 0
                ? 'bg-zinc-900 border-[#b5ff00]/40'
                : 'bg-zinc-950/70 border-zinc-800/70'
            }`}
          >
            <div className="flex items-center justify-between font-mono text-xs text-zinc-400">
              <span className="font-bold text-zinc-300">{item.shortLabel}</span>
              {item.checkIns === peakWeek?.checkIns && item.checkIns > 0 && (
                <span className="text-[#b5ff00] flex items-center font-bold text-[10px] uppercase tracking-wider">
                  Peak
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-400 font-mono mt-0.5">{item.dateRange}</div>
            <div className="mt-2 flex items-baseline justify-between font-mono">
              <span className="text-lg font-bold text-zinc-100 tabular-nums">
                {item.checkIns}
              </span>
              <span className="text-xs text-zinc-400">
                {item.uniqueBuilders} {item.uniqueBuilders === 1 ? 'builder' : 'builders'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
