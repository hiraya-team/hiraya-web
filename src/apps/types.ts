export type BuiltinAppKind = "file" | "explorer" | "properties" | "settings";

export type FileAppTarget = { kind: "file"; fileId: string; editMode?: boolean };
export type ExplorerAppTarget = { kind: "explorer"; folderId: string | null };
export type PropertiesAppTarget = { kind: "properties"; entryId: string };
export type SettingsAppTarget = { kind: "settings" };
export type SystemAppTarget = {
  kind: "system";
  appId: string;
  targetKind: "file" | "folder" | "root";
  entryId: string | null;
  source?: "system" | "desktop";
  digest?: string;
  permissions?: string[];
};

export type BuiltinAppTarget = FileAppTarget | ExplorerAppTarget | PropertiesAppTarget | SettingsAppTarget | SystemAppTarget;

export type BuiltinAppWindow = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

export type BuiltinAppEntryDependency = {
  entryId: string;
  kind: "entry" | "file" | "folder";
};
