import type { WorkflowStep, WorkflowStepStatus } from './command-center-model';
import type { AppTab } from './navigation';
import type { RuntimeStateSummary, ConfigAvailabilityEntry } from './api';
import { formatDate } from './view-model';

const PRODUCT_CAPABILITIES = [
  {
    title: '同步 Skills',
    copy: '把 ~/.agents/skills 作为个人能力库同步到多台机器。',
  },
  {
    title: '同步规则文件',
    copy: '统一维护 AGENTS.md、CLAUDE.md、GEMINI.md 等常用 Agent 规则。',
  },
  {
    title: 'Provider / Model 中央目录',
    copy: '集中维护多个 provider、模型、上下文窗口、思考深度与视觉能力。',
  },
  {
    title: '映射到官方配置',
    copy: '把中央目录快速写入 Codex、OpenCode、Claude Code、OpenClaw 与 OhMyOpenAgent 官方配置。',
  },
  {
    title: '安全预览与备份',
    copy: '应用前先预览变更，写入时保留备份和未管理字段。',
  },
  {
    title: '可选自动同步',
    copy: '配置后台策略后，让本机定时拉取并应用远端配置。',
  },
] as const;

type WorkflowOverviewProps = {
  readonly isFirstRunUser: boolean;
  readonly runtimeState: RuntimeStateSummary | null;
  readonly configAvailability: ConfigAvailabilityEntry[];
  readonly steps: readonly WorkflowStep[];
  readonly onNavigate: (tab: AppTab) => void;
  readonly onRunDryRun: () => void;
};

export function WorkflowOverview({
  isFirstRunUser,
  runtimeState,
  configAvailability,
  steps,
  onNavigate,
  onRunDryRun,
}: WorkflowOverviewProps) {
  if (isFirstRunUser) {
    return <FirstRunHome steps={steps} onNavigate={onNavigate} onRunDryRun={onRunDryRun} />;
  }

  return (
    <DashboardHome
      runtimeState={runtimeState}
      configAvailability={configAvailability}
      steps={steps}
      onNavigate={onNavigate}
      onRunDryRun={onRunDryRun}
    />
  );
}

function FirstRunHome({
  steps,
  onNavigate,
  onRunDryRun,
}: {
  readonly steps: readonly WorkflowStep[];
  readonly onNavigate: (tab: AppTab) => void;
  readonly onRunDryRun: () => void;
}) {
  return (
    <section className="workflow-page" id="overview-panel" aria-labelledby="workflow-title">
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">COMMAND CENTER</p>
          <h2 id="workflow-title">Agent 配置同步中心</h2>
          <p>用一个私有 Gist 集中维护 Skills、规则文件和 Provider / Model 目录，并同步到本机 Agent。</p>
        </div>
        <button className="secondary-action secondary-action--compact" type="button" onClick={() => onNavigate('remote')}>
          开始设置
        </button>
      </div>

      <section className="product-overview" aria-label="agentcfg 能力说明">
        <div className="product-overview__intro">
          <p className="eyebrow">PRODUCT SCOPE</p>
          <h3>把 Agent Skills、规则文件和 Provider / Model 配置放到一个中央目录里。</h3>
          <p>
            首次使用只需要连接 GitHub、维护中央 Provider / Model 目录，再预览并应用到本机 Agent。
          </p>
        </div>
        <div className="product-capability-grid">
          {PRODUCT_CAPABILITIES.map((capability) => (
            <article className="product-capability" key={capability.title}>
              <strong>{capability.title}</strong>
              <span>{capability.copy}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="workflow-list">
        {steps.map((step) => (
          <article className={`workflow-step workflow-step--${step.status}`} key={step.id}>
            <button className="workflow-step__body" type="button" onClick={() => onNavigate(step.target)}>
              <span className="workflow-step__marker" aria-label={`步骤 ${step.order}`}>{step.order}</span>
              <span className="workflow-step__copy">
                <strong>{step.title}</strong>
                <span>{step.copy}</span>
              </span>
              <span className="workflow-step__detail">{step.detail}</span>
            </button>
            <div className="workflow-step__actions">
              <span className={`status-badge status-badge--${badgeTone(step.status)}`}>{statusLabel(step.status)}</span>
              <button className={step.action.kind === 'dry-run' ? 'primary-action primary-action--compact' : 'secondary-action secondary-action--compact'} type="button" onClick={() => handleAction(step, onNavigate, onRunDryRun)}>
                {step.action.label}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DashboardHome({
  runtimeState,
  configAvailability,
  steps,
  onNavigate,
  onRunDryRun,
}: {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly configAvailability: ConfigAvailabilityEntry[];
  readonly steps: readonly WorkflowStep[];
  readonly onNavigate: (tab: AppTab) => void;
  readonly onRunDryRun: () => void;
}) {
  const hasCache = runtimeState?.cache.present === true;
  const gistId = runtimeState?.gist.id ?? '未连接';
  const defaultProvider = runtimeState?.cache.config?.defaults.provider ?? '未配置';
  const defaultModel = runtimeState?.cache.config?.defaults.model ?? '未配置';
  const availableAgentsCount = configAvailability.filter((a) => a.available).length;
  const lastSyncRun = runtimeState?.lastSyncRun;

  const nextStep = steps.find((s) => s.status === 'ready' || s.status === 'pending') ?? steps[steps.length - 1];

  return (
    <section className="workflow-page dashboard-home" id="overview-panel" aria-labelledby="workflow-title">
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">COMMAND CENTER</p>
          <h2 id="workflow-title">工作台</h2>
          <p>查看同步状态并执行下一次操作。</p>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-card" aria-label="同步状态">
          <h3 className="eyebrow">同步状态</h3>
          <ul className="detail-list">
            <li>
              <span>Gist 远端</span>
              <strong>{hasCache ? '已缓存' : '未缓存'} ({gistId})</strong>
            </li>
            <li>
              <span>默认模型</span>
              <strong>{defaultProvider} / {defaultModel}</strong>
            </li>
            <li>
              <span>可用 Agent</span>
              <strong>{availableAgentsCount} 个可编辑配置</strong>
            </li>
            <li>
              <span>最近同步</span>
              <strong>
                {lastSyncRun === undefined
                  ? '无最近同步记录'
                  : `${lastSyncRun.status === 'success' ? '成功' : lastSyncRun.status === 'partial' ? '部分成功' : '失败'} (${formatDate(lastSyncRun.completedAt)})`}
              </strong>
            </li>
          </ul>
        </section>

        <section className="dashboard-card" aria-label="快捷操作">
          <h3 className="eyebrow">快捷操作</h3>
          <div className="action-stack">
            <button className="primary-action" type="button" onClick={() => onNavigate('sync')}>
              进入同步
            </button>
            <button className="secondary-action" type="button" onClick={() => onNavigate('remote')}>
              配置模型
            </button>
            {nextStep && (
              <div className="next-action-hint">
                <p>建议操作：{nextStep.title}</p>
                <button
                  className={nextStep.action.kind === 'dry-run' ? 'primary-action primary-action--compact' : 'secondary-action secondary-action--compact'}
                  type="button"
                  onClick={() => handleAction(nextStep, onNavigate, onRunDryRun)}
                >
                  {nextStep.action.label}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function handleAction(step: WorkflowStep, onNavigate: (tab: AppTab) => void, onRunDryRun: () => void): void {
  if (step.action.kind === 'dry-run') {
    onRunDryRun();
    return;
  }
  onNavigate(step.action.target);
}

function badgeTone(status: WorkflowStepStatus): 'ready' | 'pending' | 'warning' {
  if (status === 'complete') return 'ready';
  if (status === 'blocked' || status === 'warning') return 'warning';
  return 'pending';
}

function statusLabel(status: WorkflowStepStatus): string {
  if (status === 'complete') return '已完成';
  if (status === 'ready') return '可执行';
  if (status === 'pending') return '待办';
  if (status === 'blocked') return '受阻';
  return '需注意';
}
