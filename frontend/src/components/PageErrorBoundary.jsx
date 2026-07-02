import { Component } from "react";

export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      errorMessage: "",
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || "Something went wrong on this page.",
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Page error boundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "70vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            background: "#f4f7fb",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "760px",
              background: "#ffffff",
              border: "1px solid #fecaca",
              borderRadius: "24px",
              padding: "26px",
              boxShadow: "0 18px 45px rgba(15, 23, 42, 0.12)",
            }}
          >
            <p
              style={{
                margin: 0,
                color: "#dc2626",
                fontSize: "13px",
                fontWeight: "950",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Page Error
            </p>

            <h1
              style={{
                margin: "8px 0 10px",
                color: "#07182c",
                fontSize: "30px",
                lineHeight: 1.1,
              }}
            >
              This page failed to load safely.
            </h1>

            <p
              style={{
                margin: "0 0 16px",
                color: "#64748b",
                lineHeight: 1.6,
                fontWeight: "700",
              }}
            >
              The system stopped this page from making the whole app blank.
              Please copy the error below and fix the page file.
            </p>

            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                borderRadius: "14px",
                padding: "14px",
                color: "#991b1b",
                fontWeight: "800",
                overflowX: "auto",
              }}
            >
              {this.state.errorMessage}
            </pre>

            <button
              type="button"
              onClick={this.handleReload}
              style={{
                marginTop: "16px",
                border: "none",
                borderRadius: "12px",
                padding: "12px 16px",
                background: "#07182c",
                color: "#ffffff",
                fontWeight: "950",
                cursor: "pointer",
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}