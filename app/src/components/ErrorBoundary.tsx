import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback: (reset: () => void) => ReactNode; resetKey?: unknown };
type State = { failed: boolean; key: unknown };

/** If something inside crashes, show `fallback` instead of a blank white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    // new data for this spot (e.g. a different story): try drawing again
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.warn('CyberSid screen error:', error);
  }

  reset = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
