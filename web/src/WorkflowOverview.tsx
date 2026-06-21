import type { WorkflowStep, WorkflowStepStatus } from './command-center-model';
import type { AppTab } from './navigation';

const PRODUCT_CAPABILITIES = [
  {
    title: '同步 Agent Skills',
    copy: '把 Gist 中维护的 ~/.agents/skills 目录同步到本机，让多台设备共享同一套可复用能力。',
  },
  {
    title: '统一模型目录',
    copy: '集中维护 provider、model、Base URL、API Key 与模型变体，避免每个 Agent 各配一份。',
  },
  {
    title: '按 Agent 生成配置',
    copy: '根据 Codex、Claude、Gemini、OpenCode、OpenClaw、OhMyOpenAgent 的原生格式写入最合适的模型配置。',
  },
  {
    title: '规则文件同步',
    copy: '同步用户级 AGENTS.md、CLAUDE.md、GEMINI.md，让个人开发习惯跟随设备迁移。',
  },
  {
    title: 'Gist 单点更新',
    copy: '以远端 Gist 为真源，修改一次后通过 dry-run、APPLY 或后台任务分发到各台机器。',
  },
  {
    title: '定时自动更新',
    copy: '按间隔选择同步目标，由系统后台服务自动拉取远端配置并记录最近结果。',
  },
] as const;

type WorkflowOverviewProps = {
  readonly steps: readonly WorkflowStep[];
  readonly onNavigate: (tab: AppTab) => void;
  readonly onRunDryRun: () => void;
};

export function WorkflowOverview({ onNavigate, onRunDryRun, steps }: WorkflowOverviewProps) {
  return (
    <section className="workflow-page" id="overview-panel" aria-labelledby="workflow-title">
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Command Center</p>
          <h2 id="workflow-title">配置同步工作流</h2>
          <p>从远端 Gist 到本地 Agent 配置的完整同步路径。</p>
        </div>
        <button className="secondary-action secondary-action--compact" type="button" onClick={() => onNavigate('automation')}>
          同步设置
        </button>
      </div>

      <section className="product-overview" aria-label="agentcfg 能力说明">
        <div className="product-overview__intro">
          <p className="eyebrow">Product Scope</p>
          <h3>以 Gist 为远端真源，同步 Agent Skills、规则文件与模型配置。</h3>
          <p>
            agentcfg 面向多设备、多 Agent 的个人开发环境管理：先在一个 Gist 里维护你信任的配置，再用 dry-run、备份和定时任务把它们分发到本地。
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
