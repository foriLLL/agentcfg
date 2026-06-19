export type AppTab = 'overview' | 'remote' | 'sync' | 'automation';

export type NavigationIconName = AppTab;

export type NavigationItem = {
  readonly id: AppTab;
  readonly icon: NavigationIconName;
  readonly label: string;
  readonly group: 'overview' | 'configuration' | 'automation';
};

export const COMMAND_CENTER_NAV_ITEMS = [
  { id: 'overview', icon: 'overview', label: '概览', group: 'overview' },
  { id: 'remote', icon: 'remote', label: '远端真源', group: 'configuration' },
  { id: 'sync', icon: 'sync', label: '同步到本地', group: 'configuration' },
  { id: 'automation', icon: 'automation', label: '自动化', group: 'automation' },
] as const satisfies readonly NavigationItem[];

export function navigationGroupLabel(group: NavigationItem['group']): string {
  if (group === 'overview') return '工作台';
  if (group === 'configuration') return '配置';
  return '系统';
}
