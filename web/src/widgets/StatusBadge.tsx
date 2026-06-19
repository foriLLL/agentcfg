import type { StatusTone } from '../strings';

type StatusBadgeProps = {
  readonly children: string;
  readonly tone: StatusTone;
};

export function StatusBadge({ children, tone }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
