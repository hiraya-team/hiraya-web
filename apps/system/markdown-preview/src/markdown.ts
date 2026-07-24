const blockPattern = /^(#{1,6})\s+(.+)$|^```([^\n]*)$|^[-*]\s+(.+)$|^>\s?(.+)$/;

export function renderMarkdown(source: string, document: Document): DocumentFragment {
  const output = document.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const match = blockPattern.exec(line);
    if (match?.[1]) { const heading = document.createElement(`h${match[1].length}`); appendInline(heading, match[2], document); output.append(heading); index += 1; continue; }
    if (match && line.startsWith("```")) {
      const code = document.createElement("code");
      const pre = document.createElement("pre");
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      code.textContent = body.join("\n"); pre.append(code); output.append(pre); continue;
    }
    if (match?.[4]) {
      const list = document.createElement("ul");
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        const li = document.createElement("li"); appendInline(li, item[1], document); list.append(li); index += 1;
      }
      output.append(list); continue;
    }
    if (match?.[5]) { const quote = document.createElement("blockquote"); appendInline(quote, match[5], document); output.append(quote); index += 1; continue; }
    const paragraph = document.createElement("p");
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() && !blockPattern.test(lines[index])) body.push(lines[index++]);
    appendInline(paragraph, body.join(" "), document); output.append(paragraph);
  }
  return output;
}

function appendInline(parent: HTMLElement, text: string, document: Document) {
  for (const part of inlineParts(text)) {
    if (part.kind === "text") { parent.append(document.createTextNode(part.value)); continue; }
    if (part.kind === "image") {
      const image = document.createElement("img"); image.alt = part.label; image.dataset.relativeSrc = part.value; parent.append(image); continue;
    }
    if (part.kind === "link") {
      const link = document.createElement("a"); link.textContent = part.label;
      if (/^(https?:|mailto:)/i.test(part.value)) { link.href = part.value; link.rel = "noreferrer"; link.target = "_blank"; }
      else link.dataset.relativeHref = part.value;
      parent.append(link); continue;
    }
    const element = document.createElement(part.kind); element.textContent = part.value; parent.append(element);
  }
}

export type InlinePart = { kind: "text" | "code" | "strong"; value: string } | { kind: "link" | "image"; value: string; label: string };

export function inlineParts(text: string): InlinePart[] {
  const pattern = /(!?)\[([^\]]+)\]\(([^)]+)\)|(`[^`]+`)|\*\*([^*]+)\*\*/g;
  let cursor = 0;
  const parts: InlinePart[] = [];
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) > cursor) parts.push({ kind: "text", value: text.slice(cursor, match.index) });
    if (match[1] === "!") parts.push({ kind: "image", label: match[2], value: match[3] });
    else if (match[2]) parts.push({ kind: "link", label: match[2], value: match[3] });
    else if (match[4]) parts.push({ kind: "code", value: match[4].slice(1, -1) });
    else parts.push({ kind: "strong", value: match[5] });
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  return parts;
}
