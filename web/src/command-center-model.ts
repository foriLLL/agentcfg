import type { ApplyAgentResult, RuntimeStateSummary } from './api';
import type { CommandCenterStatusSnapshot } from './useCommandCenterStatus';
import type { AppTab } from './navigation';

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

export function buildCommandCenterWorkflow(input: WorkflowModelInput): WorkflowStep[] {
  const hasGist = input.runtimeState?.gist.present === true;
  const hasCache = input.runtimeState?.cache.present === true;
  const hasPlan = input.isPlanCurrent;
  const hasApplied = input.applyResults?.some((result) => result.status === 'applied') === true;
  const ruleFilesReady = input.status.ruleFiles?.existingCount !== undefined && input.status.ruleFiles.existingCount > 0;
  const skillsReady = input.status.skills?.exists === true || (input.status.skills?.fileCount ?? 0) > 0;
  const syncEnabled = input.runtimeState?.autoSync?.enabled === true;

  return [
    {
      id: 'gist',
      order: 1,
      title: 'Gist 连接',
      copy: '连接远程 Gist 并保存访问状态。',
      detail: hasGist ? `Gist ID: ${input.runtimeState?.gist.id ?? '已连接'}` : '等待 GitHub Token 或 Gist ID。',
      status: hasGist ? 'complete' : 'ready',
      target: 'connection',
      action: { kind: 'navigate', target: 'connection', label: hasGist ? '查看连接' : '连接 Gist' },
    },
    {
      id: 'remote',
      order: 2,
      title: '远端配置',
      copy: '拉取或维护 agentcfg.yaml 真源。',
      detail: hasCache ? `缓存更新于 ${input.runtimeState?.cache.updatedAt ?? '当前会话'}` : '连接 Gist 后拉取远端配置。',
      status: hasCache ? 'complete' : hasGist ? 'ready' : 'blocked',
      target: 'remote',
      action: { kind: 'navigate', target: 'remote', label: hasCache ? '查看配置' : '加载远端' },
    },
    {
      id: 'managed-files',
      order: 3,
      title: '规则与 Skills',
      copy: '同步用户级规则文件与 ~/.agents/skills。',
      detail: `规则文件 ${input.status.ruleFiles?.existingCount ?? 0}/${input.status.ruleFiles?.totalCount ?? 3}，Skills ${input.status.skills?.fileCount ?? 0} 个文件。`,
      status: ruleFilesReady || skillsReady ? 'complete' : hasGist ? 'ready' : 'blocked',
      target: ruleFilesReady ? 'skills' : 'rules',
      action: { kind: 'navigate', target: ruleFilesReady ? 'skills' : 'rules', label: '查看同步对象' },
    },
    {
      id: 'auto-sync',
      order: 4,
      title: '自动同步策略',
      copy: '配置定时同步目标和系统后台服务。',
      detail: syncEnabled ? `已启用，每 ${input.runtimeState?.autoSync?.intervalMinutes ?? 60} 分钟` : '未启用自动同步。',
      status: syncEnabled ? 'complete' : hasGist ? 'ready' : 'blocked',
      target: 'sync',
      action: { kind: 'navigate', target: 'sync', label: syncEnabled ? '查看策略' : '配置策略' },
    },
    {
      id: 'dry-run',
      order: 5,
      title: '预览更改 (Dry Run)',
      copy: '计算将写入本地 Agent 配置的变更。',
      detail: hasPlan ? 'Dry-run 结果已就绪。' : input.canReview ? '可直接运行 dry-run。' : '需要先拉取远端配置并选择目标。',
      status: hasPlan ? 'complete' : input.canReview ? 'ready' : hasCache ? 'pending' : 'blocked',
      target: 'execute',
      action: input.canReview ? { kind: 'dry-run', label: '运行预览' } : { kind: 'navigate', target: 'execute', label: '进入审阅' },
    },
    {
      id: 'apply',
      order: 6,
      title: '应用更改 (Apply)',
      copy: '输入强确认后把变更应用到本地。',
      detail: hasApplied ? '最近已有应用结果。' : hasPlan ? '等待 APPLY 强确认。' : '先完成 dry-run。',
      status: hasApplied ? 'complete' : hasPlan ? 'ready' : 'blocked',
      target: 'execute',
      action: { kind: 'navigate', target: 'execute', label: hasPlan ? '去应用' : '查看门禁' },
    },
  ];
}
