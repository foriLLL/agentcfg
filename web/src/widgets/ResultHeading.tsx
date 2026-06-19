type ResultHeadingProps = {
  readonly eyebrow: string;
  readonly title: string;
};

export function ResultHeading({ eyebrow, title }: ResultHeadingProps) {
  return (
    <div className="result-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
    </div>
  );
}
