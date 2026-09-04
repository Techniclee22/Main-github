"use client";

type HighlightedTextProps = {
  text: string;
  highlightIndex: number | null;
};

export function HighlightedText({
  text,
  highlightIndex,
}: HighlightedTextProps) {
  if (!text) {
    return (
      <p className="reader-empty">
        Text from your shared screen will appear here so you can follow along.
      </p>
    );
  }

  if (highlightIndex === null || highlightIndex < 0) {
    return <p className="reader-body">{text}</p>;
  }

  const start = highlightIndex;
  let end = text.indexOf(" ", start + 1);
  if (end === -1) end = text.length;
  while (end < text.length && /[.,!?;:]/.test(text[end] ?? "")) end += 1;

  return (
    <p className="reader-body" aria-live="off">
      <span>{text.slice(0, start)}</span>
      <mark className="reader-mark">{text.slice(start, end)}</mark>
      <span>{text.slice(end)}</span>
    </p>
  );
}
