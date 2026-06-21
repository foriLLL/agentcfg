import type { ApplyAgentStatus, RuntimeStateSummary } from './api';

export type StatusTone = 'ready' | 'pending' | 'warning';

export type StatusBadgeCopy = {
  readonly tone: StatusTone;
  readonly label: string;
};

export const NAV = {
  home: '首页',
  config: '配置',
  sync: '同步',
  rulesAndSkills: '规则与 Skills',
  settings: '设置',
  overview: '概览',
  remote: '远端真源',
  syncToLocal: '同步到本地',
  automation: '自动化',
  groupOverview: '工作台',
  groupConfiguration: '配置',
  groupSystem: '系统',
} as const;

export const ACTIONS = {
  saveConfig: '保存配置',
  saveConfigRunning: '正在保存配置…',
  previewChanges: '预览变更',
  previewChangesRunning: '正在预览变更…',
  previewChangesRetry: '重新预览',
  applyChanges: '应用变更',
  applyChangesRunning: '正在应用变更…',
} as const;

export function gistConnectionBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.gist.present === true
    ? { tone: 'ready', label: '已连接' }
    : { tone: 'pending', label: '未连接' };
}

export function cacheReadinessBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.cache.present === true
    ? { tone: 'ready', label: '已缓存' }
    : { tone: 'pending', label: '未缓存' };
}

export function remoteRevisionBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.remote !== undefined
    ? { tone: 'ready', label: '已同步' }
    : { tone: 'pending', label: '尚未拉取' };
}

export function conflictBaselineBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.conflict.present === true
    ? { tone: 'ready', label: '已记录基线' }
    : { tone: 'pending', label: '未记录基线' };
}

export function syncServiceBadge(installed: boolean | undefined): StatusBadgeCopy {
  return installed === true
    ? { tone: 'ready', label: '服务已安装' }
    : { tone: 'pending', label: '服务未安装' };
}

export function previewReadinessBadge(input: {
  readonly hasPlan: boolean;
  readonly hasTarget: boolean;
}): StatusBadgeCopy {
  if (input.hasPlan) {
    return { tone: 'ready', label: '预览已就绪' };
  }
  if (!input.hasTarget) {
    return { tone: 'pending', label: '请选择目标' };
  }
  return { tone: 'warning', label: '需要重新预览' };
}

export function configDraftBadge(input: {
  readonly loaded: boolean;
  readonly dirty: boolean;
}): StatusBadgeCopy {
  if (!input.loaded) {
    return { tone: 'pending', label: '未加载' };
  }
  if (input.dirty) {
    return { tone: 'warning', label: '有未保存修改' };
  }
  return { tone: 'ready', label: '已同步' };
}

export const DEBUG = {
  cache: '本地缓存',
  revision: 'Revision',
  etag: 'ETag',
  baseline: '基线',
  statePath: '状态路径',
  gistId: 'Gist ID',
  rawYaml: '原始 YAML',
  schemaDocs: 'Schema 文档',
} as const;

export const BUTTONS = {
  dryRun: '预览 (Dry-run)',
  dryRunRetry: '重新预览',
  dryRunRunning: '正在预览…',
  apply: '应用变更',
  applyRunning: '正在应用…',
  pullCache: '刷新本地缓存',
  pullCacheRunning: '正在刷新…',
  loadRemote: '读取远端',
  loadRemoteRunning: '正在读取…',
  saveRemote: '保存到 Gist',
  saveRemoteRunning: '正在保存…',
} as const;

export const GATES = {
  applyConfirmEyebrow: '应用前确认',
  applyConfirmTitle: '输入 APPLY 解锁应用',
  applyConfirmHint: '只有所选目标与最近一次预览匹配时才会解锁。',
  applyConfirmPlaceholder: 'APPLY',
} as const;

export const NOTICES = {
  connected: '状态已连接',
  remoteReadyToCreate: '准备创建远端配置',
  pullSucceeded: '已拉取远端配置',
  pullFailed: '拉取需要处理',
  initFailed: '初始化失败',
  remoteSetupFailed: 'Token 配置失败',
  remoteLoaded: '远端配置已加载',
  remoteLoadFailed: '加载远端配置失败',
  remoteSaved: '远端配置已保存',
  remoteSaveFailed: '保存远端配置失败',
  remoteValidationFailed: '远端配置无效',
  tokenCleared: '已清除本地 Token',
  tokenClearFailed: '清除 Token 失败',
  dryRunSucceeded: '预览完成',
  dryRunFailed: '预览失败',
  applySucceeded: '应用完成',
  applyFailed: '应用失败',
  configLoadFailed: '配置加载失败',
  configSaveFailed: '配置保存失败',
  selectTarget: '请选择目标',
} as const;

export function applyStatusLabel(status: ApplyAgentStatus | undefined): string {
  if (status === undefined) return '未返回';
  if (status === 'would-change') return '将会变更';
  if (status === 'applied') return '已应用';
  if (status === 'unchanged') return '无变化';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return status;
}

export function applyStatusTone(status: ApplyAgentStatus | undefined): StatusTone {
  if (status === 'applied' || status === 'unchanged') return 'ready';
  if (status === 'failed' || status === 'cancelled') return 'warning';
  return 'pending';
}
