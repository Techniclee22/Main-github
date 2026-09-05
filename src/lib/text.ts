/** Split long text into speakable chunks for engines with length limits. */
export function chunkText(text: string, maxChars = 3500): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n\n", maxChars);
    if (cut < maxChars * 0.4) cut = remaining.lastIndexOf(". ", maxChars);
    if (cut < maxChars * 0.4) cut = remaining.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.4) cut = maxChars;

    const end = cut + (remaining[cut] === "." ? 2 : 0);
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function tokenizeForHighlight(text: string): {
  words: string[];
  offsets: number[];
} {
  const words: string[] = [];
  const offsets: number[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    words.push(match[0]);
    offsets.push(match.index);
  }
  return { words, offsets };
}
