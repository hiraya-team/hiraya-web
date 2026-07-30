import { connectHiraya, HirayaSdkError } from "@hiraya/apps-sdk";
import { bindTheme } from "@hiraya/apps-ui";
import { defineHirayaPrimitives } from "@hiraya/apps-ui/elements/primitives";
import "@hiraya/apps-ui/styles.css";
import "./style.css";

const APP_ID = "dev.hiraya.starter";
defineHirayaPrimitives();
const countElement = document.querySelector<HTMLElement>("#count");
const statusElement = document.querySelector<HTMLElement>("#status");
const button = document.querySelector("hiraya-button");

try {
  const hiraya = await connectHiraya({ appId: APP_ID });
  const launch = await hiraya.app.getLaunchContext();
  const unsubscribeTheme = bindTheme(hiraya, launch.theme);
  const storedCount = await hiraya.storage.get("count");
  let count = typeof storedCount === "number" && Number.isSafeInteger(storedCount) && storedCount >= 0 ? storedCount : 0;

  const render = () => {
    if (countElement) countElement.textContent = String(count);
  };
  const increment = async () => {
    count += 1;
    render();
    await hiraya.storage.set("count", count);
  };

  render();
  if (statusElement) statusElement.textContent = `Connected from ${launch.source}.`;
  await hiraya.window.setTitle("Hiraya App");
  await hiraya.commands.set([{ id: "increment", title: "Increment count" }]);
  const reportError = (error: unknown) => {
    if (statusElement) statusElement.textContent = error instanceof HirayaSdkError
      ? `Hiraya error (${error.code}): ${error.message}`
      : error instanceof Error ? error.message : String(error);
  };
  button?.addEventListener("click", () => void increment().catch(reportError));
  const unsubscribeCommand = hiraya.on("commands.invoked", ({ id }) => {
    if (id === "increment") void increment().catch(reportError);
  });
  addEventListener("pagehide", () => {
    unsubscribeCommand();
    unsubscribeTheme();
    hiraya.close();
  }, { once: true });
} catch (error) {
  if (statusElement) statusElement.textContent = error instanceof HirayaSdkError
    ? `Hiraya error (${error.code}): ${error.message}`
    : error instanceof Error ? error.message : String(error);
}
