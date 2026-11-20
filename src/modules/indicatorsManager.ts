export type IndicatorRootTab = 'PERSONAL' | 'FAVORITES' | 'BUILT-IN';
export type BuiltInIndicatorGroup = 'TECHNICAL' | 'FUNDAMENTAL';

export interface IndicatorTabDescriptor {
  id: IndicatorRootTab;
  label: string;
}

export const INDICATOR_ROOT_TABS: IndicatorTabDescriptor[] = [
  { id: 'PERSONAL', label: 'PERSONAL' },
  { id: 'FAVORITES', label: 'FAVORITES' },
  { id: 'BUILT-IN', label: 'BUILT-IN' },
];

export const BUILT_IN_GROUPS: Array<{ id: BuiltInIndicatorGroup; label: string }> = [
  { id: 'TECHNICAL', label: 'TECHNICAL' },
  { id: 'FUNDAMENTAL', label: 'FUNDAMENTAL' },
];
