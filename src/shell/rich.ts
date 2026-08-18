export async function loadRichDesktop() {
  const [storage, { default: Desktop }] = await Promise.all([import("../platform/storage/desktop-runtime"), import("../Desktop")]);
  await storage.prepareDesktopRuntime();
  return Desktop;
}
