import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { connectHiraya, HirayaSdkError } from "@hiraya-team/apps-sdk";
import { App, APP_ID } from "./App";
import "./style.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Hiraya POS root is missing.");

try {
  const hiraya = await connectHiraya({ appId: APP_ID, requestTimeoutMs: 120_000 });
  const launch = await hiraya.app.getLaunchContext();
  const root = createRoot(rootElement);
  root.render(<StrictMode><App hiraya={hiraya} launch={launch} /></StrictMode>);
  addEventListener("pagehide", () => {
    void hiraya.commands.clear().catch(() => undefined);
    root.unmount();
    hiraya.close();
  }, { once: true });
} catch (error) {
  rootElement.innerHTML = "";
  const failure = document.createElement("main");
  failure.className = "startup-failure";
  const title = document.createElement("h1");
  title.textContent = "Hiraya POS could not start";
  const message = document.createElement("p");
  message.textContent = error instanceof HirayaSdkError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : "The Hiraya connection failed.";
  failure.append(title, message);
  rootElement.append(failure);
}
