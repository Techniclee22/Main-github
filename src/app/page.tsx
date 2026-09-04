import { Hero } from "@/components/Hero";
import { ReaderApp } from "@/components/ReaderApp";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#reader">
        Skip to reader
      </a>
      <div className="page">
        <Hero />
        <div id="reader">
          <ReaderApp />
        </div>

        <section className="roadmap" aria-labelledby="roadmap-heading">
          <h2 id="roadmap-heading">Where this is going</h2>
          <p>
            The core loop is share what is on screen → hear it. We deepen that
            loop across devices and surfaces.
          </p>
          <ol>
            <li>
              <strong>Now:</strong> screen share (tab / window / display) with
              on-device OCR and spoken playback; camera and photo as backups.
            </li>
            <li>
              <strong>Next:</strong> better reading order for complex layouts,
              continuous listening while you scroll, richer natural voices.
            </li>
            <li>
              <strong>Later:</strong> browser extension (direct page text),
              mobile share targets, and OS accessibility integrations.
            </li>
          </ol>
        </section>

        <footer className="site-footer">
          Read to Me — built so the screen can speak for itself.
        </footer>
      </div>
    </>
  );
}
