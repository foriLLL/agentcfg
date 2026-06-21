export type AppTab = 'overview' | 'remote' | 'sync' | 'rulesSkills' | 'automation';

export type NavigationIconName = AppTab;

export type NavigationItem = {
  readonly id: AppTab;
  readonly icon: NavigationIconName;
  readonly label: string;
  readonly group: 'overview' | 'configuration' | 'automation';
};

export const COMMAND_CENTER_NAV_ITEMS = [
  { id: 'overview', icon: 'overview', label: '首页', group: 'overview' },
  { id: 'remote', icon: 'remote', label: '配置', group: 'configuration' },
  { id: 'sync', icon: 'sync', label: '同步', group: 'configuration' },
  { id: 'rulesSkills', icon: 'sync', label: '规则与 Skills', group: 'configuration' },
  { id: 'automation', icon: 'automation', label: '设置', group: 'automation' },
] as const satisfies readonly NavigationItem[];

export function navigationGroupLabel(group: NavigationItem['group']): string {
  if (group === 'overview') return '工作台';
  if (group === 'configuration') return '配置';
  return '系统';
}
