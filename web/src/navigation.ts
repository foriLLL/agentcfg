export type AppTab = 'overview' | 'connection' | 'remote' | 'config' | 'rules' | 'skills' | 'sync' | 'execute' | 'status';

export type NavigationIconName = AppTab;

export type NavigationItem = {
  readonly id: AppTab;
  readonly icon: NavigationIconName;
  readonly label: string;
  readonly group: 'overview' | 'configuration' | 'automation' | 'system';
};

export const COMMAND_CENTER_NAV_ITEMS = [
  { id: 'overview', icon: 'overview', label: '概览', group: 'overview' },
  { id: 'connection', icon: 'connection', label: 'Gist 连接', group: 'configuration' },
  { id: 'remote', icon: 'remote', label: '远端配置', group: 'configuration' },
  { id: 'config', icon: 'config', label: '本地配置', group: 'configuration' },
  { id: 'rules', icon: 'rules', label: '规则文件', group: 'configuration' },
  { id: 'skills', icon: 'skills', label: 'Agent Skills', group: 'configuration' },
  { id: 'sync', icon: 'sync', label: '自动同步', group: 'automation' },
  { id: 'execute', icon: 'execute', label: '审阅与应用', group: 'automation' },
  { id: 'status', icon: 'status', label: '状态详情', group: 'system' },
] as const satisfies readonly NavigationItem[];

export function navigationGroupLabel(group: NavigationItem['group']): string {
  if (group === 'overview') return '工作台';
  if (group === 'configuration') return '配置管理';
  if (group === 'automation') return '执行';
  return '系统';
}
