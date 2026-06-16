export type AppTab = 'overview' | 'connection' | 'remote' | 'config' | 'rules' | 'skills' | 'sync' | 'execute' | 'status';

export type NavigationItem = {
  readonly id: AppTab;
  readonly label: string;
  readonly group: 'overview' | 'configuration' | 'automation' | 'system';
};

export const COMMAND_CENTER_NAV_ITEMS = [
  { id: 'overview', label: '概览', group: 'overview' },
  { id: 'connection', label: 'Gist 连接', group: 'configuration' },
  { id: 'remote', label: '远端配置', group: 'configuration' },
  { id: 'config', label: '本地配置', group: 'configuration' },
  { id: 'rules', label: '规则文件', group: 'configuration' },
  { id: 'skills', label: 'Agent Skills', group: 'configuration' },
  { id: 'sync', label: '自动同步', group: 'automation' },
  { id: 'execute', label: '审阅与应用', group: 'automation' },
  { id: 'status', label: '状态详情', group: 'system' },
] as const satisfies readonly NavigationItem[];

export function navigationGroupLabel(group: NavigationItem['group']): string {
  if (group === 'overview') return '工作台';
  if (group === 'configuration') return '配置管理';
  if (group === 'automation') return '执行';
  return '系统';
}
