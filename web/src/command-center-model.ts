import type { ApplyAgentResult, RuntimeStateSummary } from './api';
import type { CommandCenterStatusSnapshot } from './useCommandCenterStatus';
import type { AppTab } from './navigation';
import { BUTTONS } from './strings';

export type WorkflowStepStatus = 'complete' | 'ready' | 'pending' | 'blocked' | 'warning';

export type WorkflowStepAction =
  | {
      readonly kind: 'navigate';
      readonly target: AppTab;
      readonly label: string;
    }
  | {
      readonly kind: 'dry-run';
      readonly label: string;
    };

export type WorkflowStep = {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly copy: string;
  readonly detail: string;
  readonly status: WorkflowStepStatus;
  readonly target: AppTab;
  readonly action: WorkflowStepAction;
};

export type WorkflowModelInput = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly status: CommandCenterStatusSnapshot;
  readonly isPlanCurrent: boolean;
  readonly canReview: boolean;
  readonly applyResults: readonly ApplyAgentResult[] | null;
};

/**
 * Three-step workflow that mirrors the new top-level IA:
 *
 *   1. Connect the remote source (Gist + agentcfg.yaml cache).
 *   2. Sync the remote source to local agents (dry-run + apply).
 *   3. Automate the sync (optional).
 *
 * Steps 1 and 3 collapse the historic 6-step model: previously
 * "Gist 连接" / "远端配置" were two ordered steps with the same gate
 * (no Gist, no cache), and "规则与 Skills" / "Dry Run" / "Apply" were
 * three steps that all share a single APPLY decision. This commit
 * compresses them into one step each so the overview matches the
 * navigation rather than restating internal panel structure.
 */
export function buildCommandCenterWorkflow(input: WorkflowModelInput): WorkflowStep[] {
  const hasGist = input.runtimeState?.gist.present === true;
  const hasCache = input.runtimeState?.cache.present === true;
  const hasPlan = input.isPlanCurrent;
  const hasApplied = input.applyResults?.some((result) => result.status === 'applied') === true;
  const syncEnabled = input.runtimeState?.autoSync?.enabled === true;

  return [
    {
      id: 'remote-source',
      order: 1,
      title: '连接远端真源',
      copy: '连接 Gist 并把 agentcfg.yaml 拉取到本地缓存。',
      detail: hasCache
        ? `缓存更新于 ${input.runtimeState?.cache.updatedAt ?? '当前会话'}`
        : hasGist
          ? '已连接 Gist，等待拉取缓存。'
          : '等待 GitHub Token 或 Gist ID。',
      status: hasCache ? 'complete' : hasGist ? 'ready' : 'pending',
      target: 'remote',
      action: { kind: 'navigate', target: 'remote', label: hasCache ? '查看远端' : hasGist ? '加载远端' : '连接 Gist' },
    },
    {
      id: 'sync-targets',
      order: 2,
      title: '同步到本地',
      copy: '把远端配置、规则文件与 Skills 目录写入本地 Agent。',
      detail: hasApplied
        ? '最近已有应用结果。'
        : hasPlan
          ? '预览已就绪，等待 APPLY 确认。'
          : input.canReview
            ? '可直接运行预览。'
            : hasCache
              ? '选择目标后即可运行预览。'
              : '需要先拉取远端配置。',
      status: hasApplied
        ? 'complete'
        : hasPlan
          ? 'ready'
          : input.canReview
            ? 'ready'
            : hasCache
              ? 'pending'
              : 'blocked',
      target: 'sync',
      action: input.canReview
        ? { kind: 'dry-run', label: BUTTONS.dryRun }
        : { kind: 'navigate', target: 'sync', label: hasPlan ? '去应用' : '进入同步' },
    },
    {
      id: 'automation',
      order: 3,
      title: '自动化（可选）',
      copy: '配置定时同步目标和系统后台服务。',
      detail: syncEnabled
        ? `已启用，每 ${input.runtimeState?.autoSync?.intervalMinutes ?? 60} 分钟`
        : hasGist
          ? '未启用自动同步。'
          : '连接 Gist 后再开启自动同步。',
      status: syncEnabled ? 'complete' : hasGist ? 'ready' : 'blocked',
      target: 'automation',
      action: { kind: 'navigate', target: 'automation', label: syncEnabled ? '查看策略' : '配置策略' },
    },
  ];
}
