import { useMemo, type ReactNode } from 'react';
import { NavigationIcon } from './NavigationIcon';
import { COMMAND_CENTER_NAV_ITEMS, navigationGroupLabel, type AppTab, type NavigationItem } from './navigation';

type CommandCenterShellProps = {
  readonly activeTab: AppTab;
  readonly statusRail: ReactNode;
  readonly children: ReactNode;
  readonly onTabChange: (tab: AppTab) => void;
};

export function CommandCenterShell({ activeTab, children, onTabChange, statusRail }: CommandCenterShellProps) {
  const navigationGroups = useMemo(() => groupNavigationItems(COMMAND_CENTER_NAV_ITEMS), []);

  function navigateTo(tab: AppTab): void {
    onTabChange(tab);
  }

  return (
    <main className="command-shell" aria-labelledby="page-title">
      <aside className="command-sidebar" aria-label="主导航">
        <div className="command-brand">
          <span className="command-brand__mark" aria-hidden="true" />
          <div>
            <h1 id="page-title">agentcfg</h1>
            <p>本地控制台</p>
          </div>
        </div>
        <nav className="command-nav" aria-label="功能导航">
          {navigationGroups.map((group) => (
            <section className="command-nav__group" key={group.group}>
              <p>{navigationGroupLabel(group.group)}</p>
              {group.items.map((item) => (
                <button
                  id={`${item.id}-tab`}
                  className={`command-nav__item ${activeTab === item.id ? 'command-nav__item--active' : ''}`}
                  type="button"
                  aria-current={activeTab === item.id ? 'page' : undefined}
                  onClick={() => navigateTo(item.id)}
                  key={item.id}
                >
                  <span className="command-nav__icon" aria-hidden="true">
                    <NavigationIcon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </section>
          ))}
        </nav>
      </aside>

      <section className="command-workspace">
        <div className="command-content">
          <section className="command-main" aria-label="主工作区">
            {children}
          </section>
          <aside className="command-rail" aria-label="状态面板">
            {statusRail}
          </aside>
        </div>
      </section>
    </main>
  );
}

type NavigationGroup = {
  readonly group: NavigationItem['group'];
  readonly items: readonly NavigationItem[];
};

function groupNavigationItems(items: readonly NavigationItem[]): NavigationGroup[] {
  const groups: NavigationGroup[] = [];
  for (const item of items) {
    const current = groups.find((group) => group.group === item.group);
    if (current === undefined) {
      groups.push({ group: item.group, items: [item] });
      continue;
    }
    groups.splice(groups.indexOf(current), 1, { ...current, items: [...current.items, item] });
  }
  return groups;
}
