export function Hero() {
  return (
    <header className="hero">
      <div className="hero-atmosphere" aria-hidden="true" />
      <div className="hero-content">
        <p className="brand">Read to Me</p>
        <h1>Whatever is on screen, spoken aloud.</h1>
        <p className="hero-lede">
          Share a tab, PDF, or another app window. Read to Me looks at it and
          reads the text — websites, documents, anything visible.
        </p>
        <div className="hero-cta">
          <a className="btn btn-primary btn-large" href="#reader">
            Share screen &amp; read
          </a>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="hero-glow" />
        <svg
          className="hero-illustration"
          viewBox="0 0 640 480"
          role="img"
          focusable="false"
        >
          <defs>
            <linearGradient id="pageGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f7fbf9" />
              <stop offset="100%" stopColor="#dceee8" />
            </linearGradient>
          </defs>
          <rect
            x="80"
            y="70"
            width="360"
            height="280"
            rx="16"
            fill="url(#pageGrad)"
            stroke="#0f4c4a"
            strokeOpacity="0.2"
          />
          <rect x="100" y="100" width="200" height="12" rx="6" fill="#0f4c4a" opacity="0.5" />
          <rect x="100" y="130" width="280" height="8" rx="4" fill="#0f4c4a" opacity="0.25" />
          <rect x="100" y="152" width="260" height="8" rx="4" fill="#0f4c4a" opacity="0.25" />
          <rect x="100" y="174" width="240" height="8" rx="4" fill="#c47a2c" opacity="0.75" />
          <rect x="100" y="196" width="270" height="8" rx="4" fill="#0f4c4a" opacity="0.2" />
          <rect
            x="380"
            y="200"
            width="180"
            height="220"
            rx="28"
            fill="#0f4c4a"
            opacity="0.92"
          />
          <circle cx="470" cy="310" r="36" fill="#c47a2c" />
          <polygon points="460,292 460,328 488,310" fill="#f4faf7" />
        </svg>
      </div>
    </header>
  );
}
