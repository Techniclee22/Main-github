const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { titlesOverlap, pickSource } = require("../lib/window-pick.cjs");

describe("titlesOverlap", () => {
  it("treats em dashes and × as the same title", () => {
    assert.equal(
      titlesOverlap("workspace — -zsh — 80×24", "workspace - -zsh - 80x24"),
      true,
    );
  });
});

describe("pickSource", () => {
  const sources = [
    { id: "chrome", name: "Inbox - Gmail" },
    { id: "term", name: "Main-github — -zsh — 81×30" },
    { id: "pdf", name: "handbook.pdf" },
  ];

  it("picks the Terminal tab, not Gmail, when that window is frontmost", () => {
    const picked = pickSource(sources, {
      app: "Terminal",
      title: "Main-github - -zsh - 81x30",
    });
    assert.equal(picked.id, "term");
  });

  it("picks the Terminal tab from the focused app's window list when the hint title is empty", () => {
    const picked = pickSource(
      sources,
      { app: "Terminal", title: "" },
      ["Main-github — -zsh — 81×30"],
    );
    assert.equal(picked.id, "term");
  });
});
