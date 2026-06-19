type DetailProps = {
  readonly label: string;
  readonly value: string;
};

export function Detail({ label, value }: DetailProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
