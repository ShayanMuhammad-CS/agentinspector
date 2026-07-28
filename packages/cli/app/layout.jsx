import "./globals.css";
import { createElement } from "react";

export const metadata = {
  title: "Agent Action Inspector",
  description: "Local trajectory viewer and approval gate for LangGraph agents",
};

export default function RootLayout({ children }) {
  return createElement(
    "html",
    { lang: "en" },
    createElement("body", null, children)
  );
}
