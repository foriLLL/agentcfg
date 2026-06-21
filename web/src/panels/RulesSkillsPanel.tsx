import type { ReactNode } from 'react';

type RulesSkillsPanelProps = {
  readonly rulesPanelNode: ReactNode;
  readonly skillsPanelNode: ReactNode;
};

const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

export function RulesSkillsPanel({ rulesPanelNode, skillsPanelNode }: RulesSkillsPanelProps) {
  return (
    <div className="rules-skills-page" aria-labelledby="rules-skills-title">
      <section className="rules-skills-hero">
        <div className="rules-skills-hero__copy">
          <p className="eyebrow">规则与 Skills</p>
          <h2 id="rules-skills-title">把 Agent 行为和可复用能力带到每台设备</h2>
          <p>
            规则文件定义 Agent 的行为边界、团队偏好和默认工作方式；Agent Skills 则把可复用能力沉淀到
            <code>~/.agents/skills</code>，让新机器也能快速拥有同一套工具箱。
          </p>
        </div>
        <div className="rules-skills-hero__badge" aria-label="规则文件和 Skills 的同步范围">
          <span>Managed by Gist</span>
          <strong>Rules + Skills</strong>
        </div>
      </section>

      <section className="rules-skills-primer" aria-label="规则与 Skills 说明">
        <article className="rules-skills-primer__card">
          <span className="rules-skills-primer__index">01</span>
          <div>
            <h3>规则文件定义 Agent 行为</h3>
            <p>
              <strong>{RULE_FILES.join(' / ')}</strong> 记录不同 Agent 会读取的行为准则、编码偏好和协作约束。
              agentcfg 负责把这些规则从私有 Gist 同步到本地官方用户级文件。
            </p>
          </div>
        </article>
        <article className="rules-skills-primer__card">
          <span className="rules-skills-primer__index">02</span>
          <div>
            <h3>Skills 提供跨设备复用能力</h3>
            <p>
              <code>~/.agents/skills</code> 可以保存排障、部署、文档处理等可复用能力。同步 manifest 后，常用技能可在可信设备间保持一致。
            </p>
          </div>
        </article>
        <article className="rules-skills-primer__card rules-skills-primer__card--accent">
          <span className="rules-skills-primer__index">03</span>
          <div>
            <h3>独立于 Agent 配置应用</h3>
            <p>
              这里保留规则文件和 Skills 自己的加载、dry-run、APPLY 与备份流程，不会和同步页的 Agent 配置应用语义混在一起。
            </p>
          </div>
        </article>
      </section>

      <section className="rules-skills-panels" aria-label="规则文件和 Agent Skills 操作区">
        {rulesPanelNode}
        {skillsPanelNode}
      </section>
    </div>
  );
}
