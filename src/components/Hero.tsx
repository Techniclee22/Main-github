export function Hero() {
  return (
    <header className="hero">
      <div className="hero-atmosphere" aria-hidden="true" />
      <div className="hero-content">
        <p className="brand">Read to Me</p>
        <h1>Your screen, spoken clearly.</h1>
        <p className="hero-lede">
          Point your phone or computer at anything with text — pages, signs,
          menus, messages — and hear it read aloud.
        </p>
        <div className="hero-cta">
          <a className="btn btn-primary btn-large" href="#reader">
            Start reading
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
            x="120"
            y="60"
            width="400"
            height="360"
            rx="18"
            fill="url(#pageGrad)"
            stroke="#0f4c4a"
            strokeOpacity="0.18"
          />
          <rect x="156" y="110" width="260" height="14" rx="7" fill="#0f4c4a" opacity="0.55" />
          <rect x="156" y="146" width="300" height="10" rx="5" fill="#0f4c4a" opacity="0.28" />
          <rect x="156" y="172" width="280" height="10" rx="5" fill="#0f4c4a" opacity="0.28" />
          <rect x="156" y="198" width="310" height="10" rx="5" fill="#0f4c4a" opacity="0.22" />
          <rect x="156" y="224" width="240" height="10" rx="5" fill="#0f4c4a" opacity="0.22" />
          <rect x="156" y="270" width="290" height="10" rx="5" fill="#c47a2c" opacity="0.7" />
          <rect x="156" y="296" width="270" height="10" rx="5" fill="#0f4c4a" opacity="0.2" />
          <rect x="156" y="322" width="250" height="10" rx="5" fill="#0f4c4a" opacity="0.2" />
          <circle cx="480" cy="340" r="54" fill="#0f4c4a" opacity="0.9" />
          <polygon points="468,318 468,362 504,340" fill="#f4faf7" />
          <path
            d="M430 360 Q480 300 530 360"
            fill="none"
            stroke="#c47a2c"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.85"
          />
        </svg>
      </div>
    </header>
  );
}
