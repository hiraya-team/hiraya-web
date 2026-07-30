type Props = Readonly<{
  path: string;
  value: string;
  readOnly: boolean;
  fontSize: number;
  lineWrap: boolean;
  onChange(value: string): void;
  onSave(): void;
}>;

export function Editor({ path, value, readOnly, fontSize, lineWrap, onChange, onSave }: Props) {
  return (
    <textarea
      className="editor-textarea"
      aria-label={`Contents of ${path}`}
      value={value}
      readOnly={readOnly}
      spellCheck={path.toLowerCase().endsWith(".md")}
      wrap={lineWrap ? "soft" : "off"}
      style={{ fontSize }}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSave();
        }
      }}
    />
  );
}
