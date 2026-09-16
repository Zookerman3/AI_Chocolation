// A render crash at the counter used to mean a white screen and a reload. Saved records
// and the saved case layout outlive the catalog they point at, so one renamed flavor id
// could take the whole tablet down mid-rush. The render paths now use findFlavor and
// don't throw, and this is the backstop for everything else: the app keeps its shell and
// offers a reload instead of disappearing.

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AI Chocolation crashed while rendering', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h2>The screen stopped, the boxes did not.</h2>
        <p className="helper-text" style={{ marginBottom: 18 }}>
          Saved boxes are still on this tablet — nothing was lost. Reload to carry on, and if it happens again, use
          Export CSV on the Records screen before anything else.
        </p>
        <pre>{error.message}</pre>
        <button type="button" className="button button-accent" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
