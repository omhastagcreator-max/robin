/**
 * Shared color palette for ClientSchedule entries.
 *
 * Single source of truth so the schedule page, the dashboard widget and the
 * picker all render the same color for the same value. Each entry exposes
 * the Tailwind class strings we need (background tint, text, border) — keeps
 * the rendering JSX clean and prevents arbitrary CSS injection from API.
 */

export type ScheduleColor =
  | '' // empty = use auto color from taskType
  | 'blue' | 'pink' | 'purple' | 'teal' | 'emerald'
  | 'amber' | 'orange' | 'rose' | 'indigo' | 'slate';

export interface ColorTokens {
  /** Combined Tailwind tone classes for the entry card */
  tone: string;
  /** Solid swatch class for the picker dot */
  swatch: string;
  /** Display label for tooltips */
  label: string;
}

export const SCHEDULE_COLORS: Record<Exclude<ScheduleColor, ''>, ColorTokens> = {
  blue:    { tone: 'bg-blue-500/15    text-blue-700    border-blue-500/30',    swatch: 'bg-blue-500',    label: 'Blue'    },
  pink:    { tone: 'bg-pink-500/15    text-pink-700    border-pink-500/30',    swatch: 'bg-pink-500',    label: 'Pink'    },
  purple:  { tone: 'bg-purple-500/15  text-purple-700  border-purple-500/30',  swatch: 'bg-purple-500',  label: 'Purple'  },
  teal:    { tone: 'bg-teal-500/15    text-teal-700    border-teal-500/30',    swatch: 'bg-teal-500',    label: 'Teal'    },
  emerald: { tone: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', swatch: 'bg-emerald-500', label: 'Emerald' },
  amber:   { tone: 'bg-amber-500/15   text-amber-700   border-amber-500/30',   swatch: 'bg-amber-500',   label: 'Amber'   },
  orange:  { tone: 'bg-orange-500/15  text-orange-700  border-orange-500/30',  swatch: 'bg-orange-500',  label: 'Orange'  },
  rose:    { tone: 'bg-rose-500/15    text-rose-700    border-rose-500/30',    swatch: 'bg-rose-500',    label: 'Rose'    },
  indigo:  { tone: 'bg-indigo-500/15  text-indigo-700  border-indigo-500/30',  swatch: 'bg-indigo-500',  label: 'Indigo'  },
  slate:   { tone: 'bg-slate-500/15   text-slate-700   border-slate-500/30',   swatch: 'bg-slate-500',   label: 'Slate'   },
};

/** Auto-color fallback per task type — used when entry.color is empty. */
export const AUTO_COLOR_FOR_TASK_TYPE: Record<string, Exclude<ScheduleColor, ''>> = {
  meta:       'blue',
  google_ads: 'pink',
  content:    'purple',
  design:     'teal',
  dev:        'emerald',
  strategy:   'amber',
  review:     'slate',
  meeting:    'orange',
  other:      'slate',
};

/** Resolve the active tone for an entry — explicit color wins, else auto. */
export function tokensFor(color: ScheduleColor | undefined, taskType: string | undefined): ColorTokens {
  if (color && color in SCHEDULE_COLORS) return SCHEDULE_COLORS[color as Exclude<ScheduleColor, ''>];
  const auto = AUTO_COLOR_FOR_TASK_TYPE[taskType || 'other'] || 'slate';
  return SCHEDULE_COLORS[auto];
}
