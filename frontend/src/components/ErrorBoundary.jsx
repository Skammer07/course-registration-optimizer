import { Component } from "react";
import { Alert } from "./ui/Alert.jsx";
import { Button } from "./ui/Button.jsx";

/** Last line of defence: a rendering bug shows a message and a way out, never a blank page. */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <Alert tone="critical" title="Something broke on this page">
          The rest of the app is fine. Reload the page to try again. If it keeps happening, tell the team what you were doing.
        </Alert>
        <Button variant="primary" onClick={() => window.location.reload()}>Reload the page</Button>
      </div>
    );
  }
}
