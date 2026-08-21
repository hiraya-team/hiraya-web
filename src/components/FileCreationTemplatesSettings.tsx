import { useState } from "react";
import { FileCode, Plus, Trash } from "@phosphor-icons/react";
import type { FileCreationTemplate } from "../types";
import { DEFAULT_FILE_CREATION_TEMPLATES, parseFileCreationTemplates } from "../lib/file-creation-templates";

type Props = { drafts: FileCreationTemplate[]; disabled: boolean; dirty: boolean; onDraftsChange: (drafts: FileCreationTemplate[]) => void; onChange: (templates: FileCreationTemplate[]) => Promise<void> };

/** Renders the file creation templates settings interface. */
export function FileCreationTemplatesSettings({ drafts, disabled, dirty, onDraftsChange, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(next = drafts) {
    setSaving(true);
    setError("");
    try {
      const parsed = parseFileCreationTemplates(next.map((template) => ({ ...template, extension: template.extension.startsWith(".") ? template.extension : `.${template.extension}` })));
      await onChange(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file defaults could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-section" aria-labelledby="new-file-defaults-heading">
    <div className="settings-section__heading"><FileCode size={18} /><div><h4 id="new-file-defaults-heading">New file defaults</h4><p>Set the starting content and media type for files created by extension on this desktop.</p></div><button className="button button--quiet" type="button" disabled={disabled || saving} onClick={() => void save(DEFAULT_FILE_CREATION_TEMPLATES)}>Reset defaults</button></div>
    <div className="settings-list file-template-list">
      {drafts.map((template, index) => <div className="file-template" key={index}>
        <div className="file-template__fields">
          <label><span>Extension</span><input value={template.extension} disabled={disabled || saving} onChange={(event) => onDraftsChange(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, extension: event.target.value } : item))} /></label>
          <label><span>Media type</span><input value={template.mimeType} disabled={disabled || saving} onChange={(event) => onDraftsChange(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, mimeType: event.target.value } : item))} /></label>
          <button className="icon-button" type="button" aria-label={`Remove ${template.extension || "template"}`} disabled={disabled || saving} onClick={() => onDraftsChange(drafts.filter((_, itemIndex) => itemIndex !== index))}><Trash size={17} /></button>
        </div>
        <label><span>Default content</span><textarea rows={5} value={template.content} disabled={disabled || saving} spellCheck={false} onChange={(event) => onDraftsChange(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item))} /></label>
      </div>)}
      {!drafts.length && <p className="theme-custom__empty">No defaults. New files will start empty.</p>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="settings-template-actions"><button className="button button--quiet" type="button" disabled={disabled || saving || drafts.length >= 32} onClick={() => onDraftsChange([...drafts, { extension: ".txt", mimeType: "text/plain", content: "" }])}><Plus size={16} /> Add default</button><button className="button button--primary" type="button" disabled={disabled || saving || !dirty} onClick={() => void save()}>{saving ? "Saving..." : "Save changes"}</button></div>
  </section>;
}
