/**
 * Centralized UI strings for the agentcfg Web Console.
 *
 * Goals:
 * - Pin one wording per concept (do not let "已连接" / "状态已连接" / "已绑定 Gist"
 *   coexist for the same state).
 * - Map every status badge to a single tone (`ready` / `pending` / `warning`).
 * - Provide one canonical phrase for shared verbs (Dry-run / Apply / 应用前确认),
 *   so every panel can render the same text without re-inventing it.
 *
 * Imports:
 * - Panels read tones via `gistTone()` / `cacheTone()` etc. and read fixed
 *   copy via the BUTTONS / GATES / NOTICES exports.
 */

import type { ApplyAgentStatus, RuntimeStateSummary } from './api';

export type StatusTone = 'ready' | 'pending' | 'warning';

export type StatusBadgeCopy = {
  readonly tone: StatusTone;
  readonly label: string;
};

// ----------------------------------------------------------------------------
// Status badge copy
// ----------------------------------------------------------------------------

/** Whether the local state knows which Gist to talk to. */
export function gistConnectionBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.gist.present === true
    ? { tone: 'ready', label: '已连接' }
    : { tone: 'pending', label: '未连接' };
}

/** Whether agentcfg has cached a snapshot of the remote agentcfg.yaml. */
export function cacheReadinessBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.cache.present === true
    ? { tone: 'ready', label: '已缓存' }
    : { tone: 'pending', label: '未缓存' };
}

/** Whether remote revision/etag metadata has been recorded. */
export function remoteRevisionBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.remote !== undefined
    ? { tone: 'ready', label: '已同步' }
    : { tone: 'pending', label: '尚未拉取' };
}

/** Conflict-detection baseline metadata. */
export function conflictBaselineBadge(state: RuntimeStateSummary | null): StatusBadgeCopy {
  return state?.conflict.present === true
    ? { tone: 'ready', label: '已记录基线' }
    : { tone: 'pending', label: '未记录基线' };
}

/** Background sync system service. */
export function syncServiceBadge(installed: boolean | undefined): StatusBadgeCopy {
  return installed === true
    ? { tone: 'ready', label: '服务已安装' }
    : { tone: 'pending', label: '服务未安装' };
}

/** Dry-run readiness gate for the apply flow. */
export function dryRunReadinessBadge(input: {
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

/** Native config editor draft state. */
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

// ----------------------------------------------------------------------------
// Apply / dry-run / GitHub action verbs
//
// One canonical phrase per verb so every panel reads the same text instead of
// rolling "执行 dry-run" / "预览更改" / "Dry-run" in three separate panels.
// ----------------------------------------------------------------------------

export const BUTTONS = {
  /** Run a non-destructive plan that previews what would change. */
  dryRun: '预览 (Dry-run)',
  /** Resolve a stale plan after the target/path changed. */
  dryRunRetry: '重新预览',
  /** While the dry-run request is in flight. */
  dryRunRunning: '正在预览…',
  /** Final write step. */
  apply: '应用变更',
  /** While the apply request is in flight. */
  applyRunning: '正在应用…',
  /** Pull `agentcfg.yaml` from Gist into the local cache. */
  pullCache: '刷新本地缓存',
  pullCacheRunning: '正在刷新…',
  /** Read `agentcfg.yaml` from Gist into the editor draft. */
  loadRemote: '读取远端',
  loadRemoteRunning: '正在读取…',
  /** Save the editor draft back to Gist. */
  saveRemote: '保存到 Gist',
  saveRemoteRunning: '正在保存…',
} as const;

export const GATES = {
  /** Apply confirmation gate (replaces "强确认门禁"). */
  applyConfirmEyebrow: '应用前确认',
  applyConfirmTitle: '输入 APPLY 解锁应用',
  applyConfirmHint: '只有所选目标与最近一次预览匹配时才会解锁。',
  /** Confirm input placeholder. */
  applyConfirmPlaceholder: 'APPLY',
} as const;

// ----------------------------------------------------------------------------
// Toast notice titles
//
// Pin one title per outcome.
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// Apply / dry-run status mapping (per-agent result row).
// ----------------------------------------------------------------------------

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
