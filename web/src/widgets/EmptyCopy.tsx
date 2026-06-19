type EmptyCopyProps = {
  readonly title: string;
  readonly copy: string;
};

export function EmptyCopy({ title, copy }: EmptyCopyProps) {
  return (
    <div className="mini-empty">
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}
