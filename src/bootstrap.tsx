import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Shell from "./shell/Shell";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(createElement(Shell));
