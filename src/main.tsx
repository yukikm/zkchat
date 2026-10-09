import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/noto-sans-jp";
import "./styles.css";
class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>The application could not load</h1>
        <p>Saved conversation and wallet data has not been deleted.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload application
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
