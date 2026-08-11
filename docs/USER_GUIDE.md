# Hiraya User Guide

This guide is included with Hiraya and remains available when the app shell is offline. Features can vary by browser, server configuration, and your role.

## Start here {#start-here}

Hiraya is a self-hosted, local-first desktop for spatially organizing files.

In a synchronized installation, the server is the authoritative home of desktops and files. The browser keeps a projected desktop, downloaded file copies, and queued changes so supported work can continue through a short outage. In browser-local mode, this browser is authoritative and clearing its site data removes your Hiraya content.

Use the desktop switcher for **named desktops**. Use the area button in the global header to open the [desktop area map](#desktops-and-areas) and move around within one desktop. Open Search to find files, folders, apps, commands, or the command that opens this guide.

## Changelog {#changelog}

New user-facing features are listed newest first.

### August 2026

- **Find and select Scene widgets.** Scene widgets now keep a visible corner grip for selection and movement while leaving the Scene itself interactive. Select the grip first, then drag it to move the widget.
- **Preview desktop placement.** While **Auto-arrange while dragging** shifts nearby icons, dashed placeholders show exactly where those icons will be placed. With **Snap to grid** enabled, a softly faded grid surrounds every icon, widget, icon group, or Explorer drop preview.
- **Create and place interactive Scenes.** Open `.hiraya.scene` files in **Scene Studio** to edit packaged HTML, CSS, JavaScript, and assets with an unsaved live preview. Choose **Add widget > Scene...** or **Theme Editor > Choose Hiraya file** to place a Scene as a widget or interactive wallpaper; whole public desktops run the same Scene, while reduced-motion wallpaper falls back to Hiraya Dusk and widgets wait for **Run Scene**.
- **Avoid false synchronization conflicts.** Rapid queued changes now use their latest saved revision, and changes already matched by the server resolve automatically instead of repeatedly showing a **Sync Issue**.
- **Edit themes comfortably on mobile.** **Theme Editor** now uses one natural vertical scroll on narrow screens, keeps its theme picker compact, and brings the live preview and touch-friendly controls into reach without nested scrolling.
- **Close Explorer with Back on mobile.** The upper-left **Back** action and the phone's system Back action now close Explorer instead of opening the desktop root, and another Back action no longer reopens the folder you left.
- **Select widgets before arranging them.** Moving, resizing, or removing a widget now requires selecting it first, preventing an initial click or drag from changing the desktop unexpectedly.
- **Keep neighboring icons on the grid.** With **Snap to grid** enabled, icons now stay aligned even when placed beside another icon, while **Auto-arrange while dragging** resolves any overlap at the snapped destination.
- **Keep folder double-taps contained.** Double-tapping a desktop folder on a touch screen now opens only that folder instead of also opening an item beneath the same position.
- **Keep Todo files usable on mobile and after refresh.** Todo now fits narrow screens without clipped filters or messages, and open Todo files restore after a browser refresh without losing their file access.
- **Use items across desktop area edges.** Icons, widgets, and icon groups now remain visible and usable in every desktop area they overlap, including whole public desktops.
- **Edit every text file by default.** Files identified with a text media type now open as editable text in **Integrated Editor**, including Markdown, RTF, and Hiraya shell text. Specialized viewers remain available through **Open With** and for matching extensions without a text media type.
- **Keep icon group images contained.** Image and video thumbnails inside icon groups now remain within their item instead of covering the group.
- **Keep widgets fixed on the desktop.** Widgets and icon groups now retain their exact position and dimensions when the browser changes size. Move to an adjacent desktop area to see any portion outside the current view.
- **Keep a Todo list on the desktop.** Choose **Add widget > Todo list** to link an existing Todo file, check off tasks without opening a window, or open the full list in Todo. Whole public desktops show linked lists read-only.
- **Use full file actions in icon groups.** Files and folders inside desktop icon groups now support selection, keyboard opening, context menus, and dragging between the desktop and folders just like items in Explorer.
- **Recover layout synchronization automatically.** Concurrent desktop layout changes now reconcile instead of repeatedly showing the same **Sync Issue**, and wallpaper previews no longer create duplicate saves.
- **Drop files into folders while arranging icons.** Desktop folders now stay available as drop targets while **Auto-arrange while dragging** moves nearby files out of the way.
- **Apply themes when selected.** Choosing a theme in **Theme Editor** now applies it to the desktop immediately and preserves the choice after reload while keeping its controls ready for editing.
- **Use consistent item lists.** Lists across Explorer, Settings, Applications, sharing, Trash, Theme Editor, and Integrated Editor now share predictable sorting, keyboard movement, touch actions, and drag ordering where ordering is available.
- **Swipe areas from unselected items.** On mobile, dragging a selected desktop item moves it, while dragging from an unselected item switches desktop areas instead.
- **See quieter placement previews.** Moving desktop items with **Snap to grid** enabled now highlights the exact destination without covering nearby work in a decorative grid.
- **Simplify open-window switching.** The separate **All windows** dialog has been removed. Use **Search** to find and focus any open window.
- **Keep desktop items steady between areas.** Icons, widgets, and icon groups now retain their exact size and arrangement while sliding between desktop areas.
- **Add application shortcuts to the desktop.** In **Applications**, choose **Add to desktop** for any available installed app. The new icon synchronizes with the desktop and explains when the referenced app is unavailable to another viewer.
- **Open Theme Editor directly.** Choose **Settings > Desktop > Theme Editor** to create or apply themes and customize the current desktop's wallpaper without an extra Appearance page.
- **Keep floating window chrome focused.** The redundant window-actions dropdown has been removed. Keyboard shortcuts for moving and resizing focused windows remain available under **Shortcuts**.
- **Understand app controls at a glance.** Focused apps now keep their primary and secondary actions together, label **More** and **System** distinctly, avoid repeating visible actions in menus, and lead the title with the current file or project. Actions that cannot apply, such as saving a read-only preview, stay out of the header.
- **Preview widget and icon group placement.** When **Snap to grid** is on, moving or resizing a widget or icon group now shows the same grid placeholder used by desktop icons before the change is placed.
- **Arrange icon groups with desktop items.** Folder icon groups now reserve their full desktop space, move nearby icons out of the way, and follow the selected grid when created, moved, or resized.
- **Use clearer Integrated Editor controls.** Open-file tabs now show their active and hover states correctly, status errors use the warning color, and editor controls are easier to tap on mobile.
- **Keep widget contents stable after refresh.** Clock, Calendar, and Status widgets now keep their content and height visually stable when the desktop reloads, without requiring a tap.
- **Work quickly without false sync conflicts.** Rapid file, layout, theme, and app-data changes now use the latest synchronized state instead of reporting a conflict with your own preceding change.
- **Slide widgets between areas.** Widgets and icon groups now move with desktop icons when switching areas, keeping the desktop layout together throughout the transition.
- **Tap widgets without moving them.** Clock, Calendar, and Status widgets now stay still when a finger shifts slightly during a tap, while deliberate dragging continues to move them.
- **Navigate public apps with Back.** On a public desktop, **Back** now moves through an open app before returning to the desktop, matching the signed-in desktop behavior.
- **Arrange widgets with desktop icons.** Widgets now snap to the selected desktop grid, reserve their occupied space, and move nearby icons out of the way. Widget controls stay hidden until the widget is selected, leaving more room for its content.
- **Keep app actions in the window chrome.** Store and bundled system apps now place important file and app-wide actions such as **Open**, **Save**, **Clear**, and **Fullscreen** in the window title bar or global header. Contextual editing, navigation, and destructive controls remain beside the content they affect.
- **Preview Markdown with documents and media.** Markdown files now open in **Document & Media Viewer** with tables, task lists, strikethrough, automatic links, safe relative images, and the existing external-image controls. Existing **Markdown Preview** windows and file preferences move to the combined viewer automatically.
- **Add widgets and icon groups to the desktop.** Right-click or long-press the desktop to add **Clock**, **Calendar**, or **Status** widgets, or create an icon group backed by a real folder. Widgets and groups can be moved, resized, removed without deleting folder contents, and viewed read-only on whole public desktops.
- **Keep app controls at the edges.** Floating windows now place close, minimize, restore, and window actions at the left of their title bar while each app's promoted actions sit at the right. Maximized and touch full-surface apps move the same controls into the global header, where **Back** replaces **Start** on mobile and less-used system tools remain available under **System**.
- **Edit themes with clearer controls.** Theme Editor now opens ready to edit, keeps **Save and Apply** at the top, and scrolls only the controls when space is limited. Editor syntax colors are owned by each editor rather than desktop themes.
- **Retry queued changes in one step.** In **Sync status**, selecting **Retry** now retries that blocked change and every later queued change in order, stopping if another change still needs attention.
- **Open public files in familiar apps.** Public desktops now use the same bundled default app for each file type as signed-in desktops, while file access and controls remain read-only. Folders continue to open in Explorer, safe internet shortcuts open in a new tab, and public app packages remain download-only.
- **Prevent overlapping icons while dragging.** **Auto-arrange while dragging** is enabled by default under **Settings > Desktop > Layout**. Icons can remain side by side without touching, while overlapping icons shift down along the selected grid and the arrangement follows the desktop across devices.
- **Copy item links from the keyboard.** Select one file or folder on the desktop or in Explorer, then press **Ctrl/⌘ Shift C** to copy its link.
- **Open cached desktops immediately.** After the first visit, Hiraya now opens the desktop saved in this browser without a loading screen while account checks and server synchronization continue in the background.
- **Switch desktops from Search.** Open **Search** and run **Switch to [desktop name]** to move directly to another desktop without opening the desktop switcher.
- **Navigate areas from a compact map.** The area switcher keeps the desktop visible, shows every area in a minimap, and offers touch-friendly controls for each adjacent area. Select the desktop name in the global header to switch named desktops separately.
- **Auto-arrange desktop icons.** Open Search and run **Auto-arrange desktop icons** to neatly pack icons in the current desktop area while preserving their visual order.
- **Receive bundled app updates reliably.** After Hiraya updates, existing browsers now replace stale bundled app releases automatically while keeping each app's saved settings and data.
- **Edit and preview files together.** **Integrated Editor** opens text, source, images, PDF, audio, and video in tabs, with safe file details for other formats. Its sidebar now keeps Explorer, Search, and customization settings together without repeating the active filename across the window.
- **Dismiss open panels with Back.** On mobile, **Back** now closes the topmost dialog, notification panel, search, **User Guide**, **Start** menu, or desktop switcher before navigating away.
- **Use Back to move up one level.** On mobile, the system **Back** action returns to an app's parent page, closes an app from its home page, returns another desktop area to Home, and reliably requires three quick presses before leaving Hiraya from Home, including after reopening Hiraya.
- **Link directly to every Settings page.** Settings now uses stable addresses for each category and detail page, with embedded sharing and connection controls, direct theme and wallpaper choices, and reliable Back and Forward navigation.
- **Switch desktops from the full row.** In the desktop and area switcher, the entire desktop row now opens that desktop instead of requiring a click directly on its name.
- **Keep context-menu actions in place offline.** When a synchronized session loses its connection, **Publish...** remains visible for managers and is greyed out until the connection returns.
- **Manage desktops in Settings.** Open **Settings > Desktop > Desktops** to create, rename, delete, pin, and order owned and shared desktops, review roles, and check account limits. The desktop switcher now stays focused on switching in your chosen order, including while showing the last cached arrangement offline.
- **Synchronize approved apps across devices.** Approving an app or update once now synchronizes that exact package and its permissions to every signed-in device. **Applications** verifies each local download before enabling it and offers **Retry sync** if setup cannot finish.
- **Customize themes and wallpaper together.** Open **Settings > Desktop > Appearance** to choose a theme or built-in wallpaper directly, then use **Open Theme Editor** to choose an image and tune its fit, alignment, blur, dim, and overlay.
- **Show only real app updates.** **Applications** now recognizes the exact package installed from a synchronized account or republished catalog, so **Update** appears only when the published app package actually changed.
- **Finish saves from account apps.** Account-installed apps now stay open while synchronized file changes finish, so **Save As** can write the selected file before returning to the app.
- **See app installation progress.** In **Applications**, an app's action immediately changes to **Installing...** or **Updating...** and remains disabled while Hiraya finishes the approved operation.
- **Paste from the context menu.** **Paste** now stays available on writable desktops and folders. Hiraya pastes copied Hiraya items and complete URLs directly, or asks you to press **Ctrl/⌘ V** so the browser can share files copied from your device.
- **Synchronize account apps.** In synchronized installations, app packages, app data, preferred-handler hints, and approvals follow your account and replay after short outages. Hiraya verifies the exact package generation, digest, and permissions on each device before launch.
- **Inspect protected desktop files.** Turn on **Show hidden files** under **Settings > Files & apps** to browse the read-only `.hiraya` tree, including desktop settings, appearance resources, complete Trash subtrees, and generated thumbnails. JSON opens read-only, theme packages download without being installed, and protected files stay outside normal desktop actions, apps, search, sharing, and public links.
- **See thumbnails and hidden files safely.** Images and videos use verified generated thumbnails on synchronized and public desktops, with familiar file icons when a thumbnail is unavailable. Turn on **Show hidden files** under **Settings > Files & apps** to reveal ordinary dot-prefixed entries and the read-only `.hiraya` system thumbnail hierarchy on the signed-in desktop.
- **Sign in with Google.** On configured synchronized installations, choose **Continue with Google** to access an existing Hiraya account with the same verified email. Password sign-in remains available.
- **Browser storage reset.** This pre-release update replaces the browser's local storage engine and starts each local or synchronized account cache empty once. Close older Hiraya tabs when prompted; synchronized desktops return from the server, while browser-local content from earlier builds is intentionally removed.
- **Open Hiraya with less downloading.** Published applications now use verified catalog details until you install or update them, avoiding repeated package downloads during startup.
- **Finish app actions in one step.** Switching an app or using its controls in the desktop and area switcher now closes the switcher automatically.
- **Automate desktop work in Terminal.** Open **Terminal** to navigate and manage Hiraya files with familiar commands, pipelines, redirects, aliases, history, background jobs, and reusable `.hsh` shell scripts. Commands remain inside Hiraya's sandbox and cannot access the server operating system or network.
- **Recognize images before opening them.** Image files now show content thumbnails on the desktop and in open folders while retaining familiar file icons whenever a preview is unavailable.
- **Find applications faster.** Search **Applications** by name, description, app ID, source, or version. Clear result counts, sorted listings, and improved empty and offline messages make the App Store easier to scan.
- **Open apps at their intended size.** Apps can now size their initial window by the usable content area, so theme-specific title bars and borders no longer make their interface unexpectedly smaller.
- **Search everything together.** Open **Search** or press **Ctrl/⌘ K** to find apps, files, folders, open windows, and commands in one results list.
- **Focus more clearly on dialogs.** Dialogs now blur the desktop or app behind them more strongly, making the active task easier to distinguish.
- **Receive apps without a Hiraya update.** Administrators can now publish new applications and compatible updates independently. Ordinary app updates still wait for your approval in **Applications**, while trusted system apps update automatically and remain available offline.
- **Keep portable task lists in Todo.** In a synchronized installation, open **Applications** and install **Todo** from the App Store to add, prioritize, date, filter, complete, and safely save `.hiraya.todo` task lists. Todo and the other App Store apps share familiar Hiraya controls while keeping their specialized workflows.
- **Resolve changed files in the Merge window.** When both this browser and the server changed a file, **Merge** combines matching or separate text edits automatically and clearly separates changes that still need a choice. You can also compare media, review details for binary files, or use **Keep both** to preserve both versions as separate files.
- **Find every sharing tool together.** Open **Settings > Sharing** to manage desktop and item sharing or create account-wide short links. Appearance and icon placement now share the **Desktop** tab.
- **Browse public desktops by area.** Whole-desktop public links now preserve published icon positions and provide the same area navigator as the main desktop. Files open in movable, resizable windows with a fine pointer and focused full-surface views on touch devices.
- **Open desktops faster.** Hiraya now avoids loading unused wallpaper code and unnecessary file requests when opening synchronized and public desktops.
- **Recognize dialogs at a glance.** Search, sharing, file choices, guides, and other dialogs now use the same title bar and backdrop while keeping controls tailored to each task.
- **Paste links as shortcuts.** Copy a complete URL and paste it on the desktop or in an open folder to create a `.url` internet shortcut. The **Paste link** prompt suggests a domain-based file name before saving.
- **See download progress while copying files.** Hiraya now shows live progress when a copy needs to download file content, so you can tell that the copy is still moving forward.
- **Open and manage apps in one place.** **Applications** now brings installed apps, administrator-published apps, available updates, launch controls, and app management together.
- **Find settings by purpose.** Settings are grouped into clearer categories so related controls are easier to scan and locate.
- **Create compact links you can share.** When enabled by your administrator, open **Settings > Sharing > Short Links** to create and manage account-wide redirect links.
- **Move between areas with a mouse wheel or trackpad.** Scroll across the desktop wallpaper to switch to an adjacent area without opening the area map.
- **Preview DOCX and RTF documents.** These files now open in the bundled **Document & Media Viewer** without sending their contents to an external service.
- **Give custom themes more control over Hiraya's appearance.** Imported themes can now coordinate additional interface treatments while retaining accessible defaults.
- **Switch desktops and areas from one navigation control.** The desktop switcher now keeps each desktop's areas together, making spatial navigation easier to understand.
- **Keep independent offline changes automatically.** When local and server changes affect different parts of a desktop, Hiraya merges them instead of asking you to resolve an unnecessary conflict.
- **Drag items between open folders.** Move files and folders directly between folder windows or back onto the desktop.
- **Choose the icon placement grid.** Open **Settings > Desktop** to select the grid spacing and turn **Snap to grid** on or off.

## Files, folders, and hierarchy import {#files-and-folders}

Files and folders behave as a hierarchy even though root items can be placed anywhere on the desktop. Opening a folder shows its children and breadcrumb. Renaming, moving, or reorganizing an item does not rewrite its file content.

Use **Upload files** for individual files. Use **Import folder** to preserve a selected directory tree, including supported empty folders. Hiraya validates the complete import before making any part visible. Dragging a directory onto Hiraya also preserves its hierarchy in browsers that expose directory entries.

Some browsers do not provide directory picking or directory-drop details. When **Import folder** is unavailable, import files in supported batches and create the missing folders in Hiraya. A browser may expose files but omit empty directories; Hiraya reports this instead of pretending the tree was complete.

Dot-prefixed files and folders are hidden from the desktop shell by default. Turn on **Settings > Files & apps > Show hidden files** to show them. This also exposes a protected `.hiraya` hierarchy for desktop settings, appearance resources, complete Trash subtrees on synchronized desktops, and generated files under the existing `.hiraya/thumbnails` path. If a real root item is already named `.hiraya`, the protected folder appears as `.hiraya (System)`. Protected folders and files are temporary, read-only views: JSON opens in a read-only file window, theme packages download without being installed, and no protected item becomes part of normal selection actions, drag and drop, context menus, routes, saved sessions, search, apps, public links, sharing, publishing, or open-with choices. Browser-local mode derives its canonical JSON views from the existing local desktop record; it does not duplicate those files into browser storage.

## Named desktops and derived areas {#desktops-and-areas}

A **desktop** has its own files, folders, appearance, sharing, and permissions. Use the desktop switcher to create, rename, switch, or delete desktops when your role allows it.

An **area** is a region derived from item and window coordinates on one continuous desktop. Icon areas use the largest whole grid extent that fits the viewport; the synchronized **Grid size** setting offers 12, 24, 36, and 48-pixel spacing, with 24 pixels as the default. Windows continue to use the full viewport. When **Snap to grid** is enabled, dragging an icon shows a local grid guide around its destination. Areas are not named containers, folders, or separately saved records. Moving the last contents out of an area can make that derived area disappear.

The area button in the global header opens a temporary spatial map and always keeps Home addressable. Choose an area to navigate and close the map, or dismiss it with Escape.

Swipe the wallpaper horizontally or vertically to preview the next coordinate. Release after the preview appears to enter that one adjacent area, including an empty one; release before the preview to remain in place.

Hiraya adapts to the input devices currently available. When the browser reports a fine pointer that can hover, apps open as overlapping windows with title bars. Drag a title bar to move a window, drag an edge or corner to resize it, use the left title-bar controls to close, minimize, maximize or restore, and use app actions at the right edge. `Alt+Enter` maximizes or restores the focused window, `Alt+Arrow key` moves it to an adjacent area, `Alt+Shift+Arrow key` moves it within the current area, and `Alt+Ctrl+Arrow key` resizes it. Maximized windows and coarse-only full-surface apps move their controls and app actions into the global header; mobile uses **Back**, while **System** retains Search, notifications, desktop navigation, account controls, and applications. Disconnecting the fine pointer switches open apps to focused full-surface views without replacing their saved window positions or sizes.

Actions adapt to each invocation rather than the device as a whole. Mouse or trackpad right-click, pen context invocation, the keyboard Context Menu key, and `Shift+F10` open a positioned menu near the item. Touch long-press and touch **More actions** open an action sheet. On a hybrid laptop, using touch still opens a sheet while the mouse, pen, or keyboard opens a positioned menu. Arrow keys move through menu commands, `Escape` dismisses the current menu or sheet, and focus returns to the invoking control.

## Sharing, roles, and public links {#sharing}

Desktop owners and managers can open **Settings > Sharing > Desktop sharing** when sharing is available.

- **Owner** controls the desktop.
- **Manager** can organize, edit, customize, and manage sharing.
- **Writer** can organize and edit files.
- **Reader** can browse and download without changing the desktop.

Invitations grant permanent access to a specific person until the invitation is revoked or accepted. A deployment may also grant a default role to all signed-in users.

A public link is different from membership. Under **Desktop & item sharing**, owners and managers choose a stable desktop alias, turn **Share entire desktop** on or off, and manage published items. Right-click one file or folder and choose **Publish...** to expose only that item; a published folder includes its current descendants and files added inside it later. Renaming an alias breaks the old address, while unpublishing keeps the alias available for the same desktop or item. Public browsing does not expose unrelated entries, private Settings, activity, or edit controls.

## Offline storage {#offline}

In synchronized mode, the server remains authoritative. Opening a file may download a validated browser copy. **Make available offline** downloads the files currently selected, or the current descendants of selected folders, once. New folder descendants are not downloaded automatically. Open **Connection & Offline** to review connection state, pending or blocked work, downloaded bytes, and storage without deleting server files.

Offline availability is not a backup. Browser storage is origin-scoped: clearing site data, resetting the browser profile, uninstalling with data removal, private-browsing cleanup, or browser eviction can remove cached copies and queued changes. The origin-wide storage estimate may include Hiraya databases, app data, and other data for this origin, not only downloaded files.

Shared desktops have stricter offline rules. Cached shared content remains read-only, and shared writes require a connection so current permissions can be checked. A file that was not downloaded before going offline is unavailable until the connection returns.

## Installation and updates {#installation-and-updates}

Install Hiraya from **Settings > System > Updates** when an Install button is offered. Otherwise use the browser's **Install app** or **Add to Home Screen** command. Installation adds app-like launch and window behavior; it does not move authoritative data out of the server or protect browser-local data from site-data removal.

Production installations can check for updates in Settings. Automatic updates check in the background and ask before reloading. Save editor and app work before applying an update. If installation is unsupported, keep using Hiraya in a normal browser tab; all core desktop data remains in the same browser origin.

## `.hiraya.app` apps, themes, and permissions {#apps-and-permissions}

A new or empty desktop includes six trusted system apps without adding package files to the desktop: Integrated Editor, Image Viewer, Document & Media Viewer, File Viewer, Terminal, and Theme Editor. Hiraya updates these bundled apps with the app shell, keeps their local app data during automatic updates, and does not allow them to be uninstalled. **Applications** identifies their system source and trust. **Reset data** clears one app's browser-local data without deleting user files. Folder browsing is built into the desktop shell so it shares the desktop's selection, context menus, imports, offline state, and window behavior.

Integrated Editor can open a selected folder as a workspace with a file tree, filename search, file management, tabs, and parent-folder breadcrumbs. It edits text and source files, previews images, PDF, audio, and video, and shows safe details for other file types. It reloads an open clean document when it changes elsewhere and preserves each tab's unsaved text with a conflict warning when the document is dirty. Open **Settings** in its sidebar to change auto-save, format-on-save, font-size, and wrapping preferences; these start from the desktop editor settings on first launch, then remain app-local to this browser and signed-in account.

Ordinary file and folder opens use these apps by default. `.hiraya.app` remains reserved for package installation and `.url` remains reserved for internet shortcuts. Use **Open with** to choose another matching installed app or make it preferred for the file's longest extension (including compound extensions). Manage or reset preferences under **Settings > Files & apps > File type defaults**. In synchronized installations, ordinary app packages, app data, approvals, and preferred-handler hints belong to the account rather than a desktop. Browser-local installations keep the existing device-local behavior. A synchronized hint activates after this device downloads and verifies the exact compatible app package; until then Hiraya reports the fallback and opens a safe bundled default.

A file ending in `.hiraya.app` can contain a Hiraya app or an importable desktop theme. Open an app package to review its name, version, and requested permissions. Open a theme package to review and apply its colors, metrics, and optional wallpaper. Unsupported, ambiguous, or malformed packages are rejected.

Theme wallpapers may be static media, looping animation or video, or a sandboxed HTML scene. Hiraya stores packaged wallpaper as a hidden synchronized asset owned by the custom theme; the original package file can be moved or deleted independently. Scene code receives no Hiraya host API, file access, network access, or pointer input, but it can still consume processor and memory resources. Animated and scene wallpapers are replaced by Hiraya Dusk when reduced motion is requested. Public desktops run their selected scene, so published scene source is downloadable and executes for anonymous visitors.

## Authoring Hiraya Scenes {#authoring-scenes}

A `.hiraya.scene` file is a ZIP archive with `hiraya.scene.json` at its root. The manifest uses schema version 1 and names one packaged HTML entrypoint:

```json
{
  "schemaVersion": 1,
  "entrypoint": "index.html"
}
```

Open an existing Scene with **Scene Studio**, or launch **Scene Studio** without a file to create a starter package. The file tree can add, rename, or remove text files and import binary assets. The live preview always uses the unsaved in-memory package. Strict validation errors disable the preview but do not prevent saving the draft, so malformed work remains recoverable. If the synchronized file changes while local edits are unsaved, use **Save As** to preserve both versions.

Scene HTML may reference packaged scripts, styles, images, fonts, and media with relative paths. Scene execution has an opaque origin, no network, frames, workers, forms, navigation, Hiraya host APIs, or file access. Scene widgets receive pointer and keyboard input. A Scene wallpaper receives input only in empty desktop space; icons, widgets, windows, and desktop chrome remain above it. The source example under `examples/scene` can be packaged with App CLI 2.2 or opened as a starting reference.

Apps run in opaque-origin sandboxed frames. Hiraya rejects static remote package references, blocks direct network APIs, forms, and top navigation with sandbox and Content Security Policy controls, strips ordinary app links, and terminates an app if its frame loads a different document after boot. Apps can interact with the host only through approved SDK services; there is currently no SDK service for opening an external URL. Browser enforcement is layered rather than perfect network isolation: embedded CSP enforcement and `navigate-to` are not supported by every browser, and a dynamically initiated self-navigation request can begin before the host receives the load event and removes the frame. Permissions can include reading or writing only files and folders you grant, opening pickers, managing the app window, adding command-palette commands, showing notifications, reading the current theme, and using app-specific storage. Account approval is tied to the exact installation generation, package digest, and ordered permission list. Each device independently verifies those values before enabling the app, and approving an update closes every running instance of the old digest before the approval is replaced.

Review installed apps and their permission names in **Applications**. **Uninstall from account** removes the synchronized package, app data, approval, and handler hints for every device. Browser-local uninstall keeps its previous behavior and does not delete the original `.hiraya.app` file or files the app saved. Only install packages you trust.

If an older user-installed app used an ID later reserved for a trusted system app, migration moves the original approval, manifest, digest, and every app-storage record into **Settings > Files & apps > Recovered app data**. Download its JSON export before removing the recovered copy.

Anonymous public desktops launch only Hiraya's bundled, verified default apps. They do not load account-installed apps or personal file associations, and their file handles remain scoped to the published entries with every write operation disabled.

## Export, operator backup, and recovery {#export-backup-and-recovery}

**Export deployment seed** creates a seeded ZIP containing the current desktop's saved files, folders, layout, appearance, and settings. It is an artifact for an operator or developer to seed a fresh frontend-only deployment. Unsaved editor changes are excluded.

Hiraya does not provide an in-product import or restore path for this seeded ZIP. It is not a personal desktop-package backup and cannot recover a synchronized installation. It does not preserve the complete catalog, accounts, sessions, sharing state, invitations, publications, activity, Trash, or server operational state.

Full synchronized recovery requires a server operator to use Hiraya's supported offline backup, verification, isolated restore, and restore-verification workflow. The operator guide is `docs/BACKUP_AND_RECOVERY.md` in the Hiraya server distribution. Ask your operator about backup frequency and the last tested restore. Users should not attempt recovery by copying browser cache files or server database files while the server is running.

## Troubleshooting {#troubleshooting}

### Sync blocked {#sync-blocked}

Open **Connection & Offline** from the summarized status button. A blocked queued change needs a decision before replay can continue. Read the affected item names and error, then open **Merge** for a file changed in both places.

For text files, the **Merge** window compares **Base** (the last synchronized text), **Mine** (this browser's change), and **Server**. It performs a true three-way merge: matching edits and edits to separate lines are combined automatically, while overlapping edits remain clearly separated for you to resolve. Line endings and the final newline are preserved. Text merge is unavailable for invalid text or files over its safety limit; choose a complete version instead.

For images, audio, and video, use the media comparison to inspect **Mine** and **Server**. Other binary files show details such as type and size rather than pretending their bytes can be merged. **Keep both** preserves both versions as separate files; use it when neither should replace the other. Discard a queued change only if you accept restoring the server version. Do not clear site data to fix sync; that can erase the queued change.

### Offline file unavailable {#offline-unavailable}

The file was not downloaded, its revision changed, or your shared access cannot be verified. Reconnect and open it, or pin it before the next outage. Check **Offline Storage** for failed downloads.

### Browser storage full {#storage-full}

Open **Connection & Offline** and release downloaded copies. Its origin-wide estimate includes all storage reported for this Hiraya origin, not all browser profiles or sites. Remove other origin data only if you understand what it belongs to. Pending uploads and authoritative browser-local files are protected by Hiraya; download important files individually before making broad storage changes.

### Permission denied or controls unavailable {#permissions}

Your reader, writer, manager, or owner role determines the controls shown. Shared writes require an online permission check. Reconnect, confirm you opened the intended desktop, and ask its owner or manager if your role is incorrect. A permission message is not a connection failure.

### Folder import unsupported {#folder-import-unsupported}

Try dragging the folder onto Hiraya. If the browser still cannot expose a hierarchy, upload supported file batches and recreate folders manually, or use a browser with directory-picker support. Empty directories cannot be inferred from a flat file list.

### Installation unavailable {#installation-unavailable}

Use Hiraya in a regular tab. Browser installation can require a secure deployment, a supported browser, and an installable production build. If no install command appears, use the browser's site menu or ask the operator whether installation is enabled.

## Changelog

### August 2026

- **Stable public addresses.** Owners and managers can set a desktop alias under **Share desktop**, enable **Share entire desktop**, or use **Publish...** on one file or folder without exposing the rest of the desktop. Desktop invitation links no longer expire.
