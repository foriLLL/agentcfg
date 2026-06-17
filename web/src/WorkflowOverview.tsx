import type { WorkflowStep, WorkflowStepStatus } from './command-center-model';
import type { AppTab } from './navigation';

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
        <button className="secondary-action secondary-action--compact" type="button" onClick={() => onNavigate('sync')}>
          同步设置
        </button>
      </div>

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
